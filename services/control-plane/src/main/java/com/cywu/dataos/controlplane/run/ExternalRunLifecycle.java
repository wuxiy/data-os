package com.cywu.dataos.controlplane.run;

import java.time.Instant;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.cywu.dataos.controlplane.executor.AdapterReconciliation;
import com.cywu.dataos.controlplane.executor.AdapterRunStatus;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterSubmissionUnknownException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 外部运行生命周期模块（领域定义见 CONTEXT.md「外部运行」）。
 *
 * <p>拥有统一的状态机：短事务领取 -> 事务外提交执行器 -> CAS 回写 ->
 * 轮询 -> 对账 -> 人工确认缺席。两侧差异（状态词汇、恢复策略、效果
 * 触达）全部来自 {@link RunPolicy} 与四个接入点，机器本身只有一份。</p>
 *
 * <p>事务纪律：终态回写与业务效果同事务（效果抛异常则整体回滚）；
 * 领取业务规则在接入方回调中、于模块的短事务内执行。</p>
 */
public final class ExternalRunLifecycle<R extends ExternalRun, C, S> {

    private static final String MANUAL_REQUIRED = "MANUAL_REQUIRED";

    private final RunStateStore<R, S> store;
    private final ExternalExecutorPort<R, C, S> executors;
    private final RunTerminalEffects<R, S> effects;
    private final RunCommandSource<R, C> recoveryCommands;
    private final RunPolicy policy;
    private final TransactionTemplate transactions;
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    public ExternalRunLifecycle(RunStateStore<R, S> store,
                                ExternalExecutorPort<R, C, S> executors,
                                RunTerminalEffects<R, S> effects,
                                RunCommandSource<R, C> recoveryCommands,
                                RunPolicy policy,
                                PlatformTransactionManager transactionManager) {
        this.store = store;
        this.executors = executors;
        this.effects = effects;
        this.recoveryCommands = recoveryCommands;
        this.policy = policy;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    /** 领取结果：重放既有运行（幂等命中）或一个待提交的 SUBMITTING 运行。 */
    public static final class ClaimOutcome<R, C> {
        private final R replayed;
        private final R run;
        private final C command;

        private ClaimOutcome(R replayed, R run, C command) {
            this.replayed = replayed;
            this.run = run;
            this.command = command;
        }

        public static <R, C> ClaimOutcome<R, C> replay(R run) {
            return new ClaimOutcome<>(run, null, null);
        }

        public static <R, C> ClaimOutcome<R, C> pending(R run, C command) {
            return new ClaimOutcome<>(null, run, command);
        }

        public R replayed() {
            return replayed;
        }

        public R run() {
            return run;
        }

        public C command() {
            return command;
        }
    }

    /** 接入方的业务领取规则，在模块的短事务内执行。 */
    @FunctionalInterface
    public interface ClaimAction<R, C> {
        ClaimOutcome<R, C> claim();
    }

    /**
     * 发起一次外部运行：短事务执行业务领取回调，随后（如非重放）在
     * 事务外提交执行器并 CAS 回写结果。
     */
    public R launch(ClaimAction<R, C> action) {
        var outcome = transactions.execute(status -> action.claim());
        if (outcome == null) {
            throw new IllegalStateException("外部运行领取未产生结果");
        }
        if (outcome.replayed() != null) {
            return outcome.replayed();
        }
        return dispatchSubmission(outcome.run(), outcome.command());
    }

    /** 定时驱动：清扫过期提交（按策略）并轮询全部候选运行。 */
    public void syncPending() {
        store.recoverStaleSubmissions(policy.submitLeaseMs());
        var now = Instant.now();
        for (var run : store.findSyncCandidates(now)) {
            syncOne(run);
        }
    }

    /** 同步单个运行并返回回写后的最新值。 */
    public R syncOne(R run) {
        if (!eligibleForPoll(run) || !inFlight.add(run.id())) {
            return run;
        }
        try {
            if (RunStatus.SUBMITTING.name().equals(run.status())) {
                recoverSubmitting(run);
            } else if (isBlank(run.externalId())) {
                reconcileByInternalId(run);
            } else {
                pollExternalStatus(run);
            }
        } finally {
            inFlight.remove(run.id());
        }
        return store.reload(run).orElse(run);
    }

    private boolean eligibleForPoll(R run) {
        if (run.terminal()) {
            return false;
        }
        if (RunStatus.SUBMITTING.name().equals(run.status())) {
            if (policy.staleSubmission() != StaleSubmissionPolicy.RESUBMIT_BACKOFF) {
                return false;
            }
            return run.nextPollAt() == null || !run.nextPollAt().isAfter(Instant.now());
        }
        if (isBlank(run.externalId())) {
            return policy.reconcileMissingExternalId()
                    && RunStatus.UNKNOWN.name().equals(run.status())
                    && (run.reconciliationStatus() == null
                        || MANUAL_REQUIRED.equals(run.reconciliationStatus()));
        }
        return switch (run.status()) {
            case "SUBMITTED", "RUNNING", "UNKNOWN" -> true;
            default -> false;
        };
    }

    // ---- 提交（发起新运行与恢复重投共用） ----

    private void recoverSubmitting(R run) {
        var command = recoveryCommands.commandFor(run);
        // 空命令表示接入方已自行处置（如所属业务对象已不存在的孤儿终态）。
        command.ifPresent(value -> dispatchSubmission(run, value));
    }

    private R dispatchSubmission(R run, C command) {
        var session = executors.find(run);
        if (session.isEmpty()) {
            return finishSubmit(run, policy.submitUnsupportedStatus(), null,
                    policy.unsupportedExecutorMessageTemplate().formatted(run.executor()), null, null);
        }
        if (!store.claimSubmissionLease(run, Instant.now().plusMillis(policy.submitLeaseMs()))) {
            return store.reload(run).orElse(run);
        }
        try {
            var submission = session.get().submit(run, command);
            if (submission == null || isBlank(submission.externalId())) {
                return finishSubmit(run, policy.submitMissingExternalIdStatus(), null,
                        policy.missingExternalIdMessage(), null, null);
            }
            return finishSubmit(run, RunStatus.SUBMITTED.name(), submission.externalId(),
                    submission.message(), Instant.now(), null);
        } catch (AdapterSubmissionUnknownException exception) {
            var unknownStatus = policy.submitUnknownOutcomeStatus();
            if (unknownStatus == null) {
                return finishSubmit(run, policy.submitFailedStatus(), null,
                        policy.submitRuntimeErrorPrefix() + safeMessage(exception), null, Instant.now());
            }
            return finishSubmit(run, unknownStatus, null, safeMessage(exception), null, null);
        } catch (AdapterUnavailableException exception) {
            if (policy.retryUnavailableSubmit()) {
                store.markSubmissionRetryable(run, safeMessage(exception), backoffRetryAt(run));
                return store.reload(run).orElse(run);
            }
            return finishSubmit(run, policy.submitUnavailableStatus(), null,
                    safeMessage(exception), null, null);
        } catch (AdapterConfigurationException exception) {
            return finishSubmit(run, policy.submitMisconfiguredStatus(), null,
                    safeMessage(exception), null, null);
        } catch (RuntimeException exception) {
            return finishSubmit(run, policy.submitFailedStatus(), null,
                    policy.submitRuntimeErrorPrefix() + safeMessage(exception), null, Instant.now());
        }
    }

    /** 提交结果的 CAS 回写；终态失败的业务效果与回写同事务。 */
    private R finishSubmit(R run, String status, String externalId, String message,
                           Instant startedAt, Instant finishedAt) {
        transactions.executeWithoutResult(transaction -> {
            var hit = store.completeSubmission(run, status, externalId, message, startedAt, finishedAt);
            if (hit && policy.submitFailureEffects() && RunStatus.isTerminal(status)) {
                effects.onSubmissionFailed(run, status, message);
            }
        });
        return store.reload(run).orElse(run);
    }

    /** 提交不可达后的指数退避：基准轮询间隔，倍率 2^attempt，封顶 1 小时。 */
    private Instant backoffRetryAt(R run) {
        var multiplier = 1L << Math.min(6, Math.max(0, run.attemptCount()));
        var delay = Math.min(3_600_000L, Math.max(1_000L, policy.pollIntervalMs()) * multiplier);
        return Instant.now().plusMillis(delay);
    }

    // ---- 轮询 ----

    private void pollExternalStatus(R run) {
        var session = executors.find(run);
        if (!store.claimStatusPoll(run, Instant.now().plusMillis(Math.max(5_000L, policy.submitLeaseMs())))) {
            return;
        }
        if (session.isEmpty()) {
            finishPoll(run, policy.pollUnsupportedStatus(),
                    policy.unsupportedExecutorMessageTemplate().formatted(run.executor()));
            return;
        }
        try {
            var result = session.get().status(run);
            var status = RunStatus.normalize(result.status());
            if (status.terminal()) {
                finishPollTerminal(run, status.name(), result.message(), result.startedAt(),
                        result.finishedAt(), result.payload());
            } else {
                store.applyStatus(run, status.name(), result.message(), result.startedAt(),
                        result.finishedAt(), result.payload(), Instant.now().plusMillis(policy.pollIntervalMs()));
            }
        } catch (AdapterUnavailableException exception) {
            pollTemporaryFailure(run, safeMessage(exception));
        } catch (AdapterConfigurationException exception) {
            finishPoll(run, policy.pollMisconfiguredStatus(), safeMessage(exception));
        } catch (RuntimeException exception) {
            pollTemporaryFailure(run, "状态同步失败：" + safeMessage(exception));
        }
    }

    /** 轮询错误终态（不受支持/配置错误）：终态回写与效果按策略同事务。 */
    private void finishPoll(R run, String status, String message) {
        if (!RunStatus.isTerminal(status)) {
            store.applyStatus(run, status, message, null, null, null, null);
            return;
        }
        transactions.executeWithoutResult(transaction -> {
            var hit = store.applyStatus(run, status, message, null, null, null, null);
            if (hit && policy.pollTerminalEffects()) {
                effects.onTerminal(run, status, null);
            }
        });
    }

    /** 执行器报告的终态：回写与业务效果同事务。 */
    private void finishPollTerminal(R run, String status, String message,
                                    Instant startedAt, Instant finishedAt, S payload) {
        transactions.executeWithoutResult(transaction -> {
            var hit = store.applyStatus(run, status, message, startedAt, finishedAt, payload, null);
            if (hit) {
                effects.onTerminal(run, status, payload);
            }
        });
    }

    private void pollTemporaryFailure(R run, String message) {
        if (policy.pollRetainsStatusOnError()) {
            store.applyStatus(run, run.status(), message, null, null, null, null);
        } else {
            store.markPollRetryable(run, message, Instant.now().plusMillis(policy.pollIntervalMs()));
        }
    }

    // ---- 按内部编号对账（仅声明了 reconcileMissingExternalId 的一侧） ----

    private void reconcileByInternalId(R run) {
        var session = executors.find(run);
        if (session.isEmpty()) {
            store.applyStatus(run, policy.pollUnsupportedStatus(),
                    policy.unsupportedExecutorMessageTemplate().formatted(run.executor()), null, null, null, null);
            return;
        }
        try {
            var result = session.get().reconcile(run);
            if (result == null) {
                store.markReconciliationRequired(run, "执行器未返回对账结果，请人工确认");
                return;
            }
            switch (result.outcome()) {
                case FOUND -> applyReconciliation(run, result);
                case NOT_FOUND -> store.markReconciliationRequired(run, result.message() == null
                        ? "未找到外部运行，请人工确认不存在后再重试" : result.message());
                case MANUAL_REQUIRED -> store.markReconciliationRequired(run, result.message() == null
                        ? "执行器无法可靠对账，请人工确认" : result.message());
            }
        } catch (AdapterConfigurationException | AdapterUnavailableException exception) {
            store.markReconciliationRequired(run, exception.getMessage());
        } catch (RuntimeException exception) {
            store.markReconciliationRequired(run, "对账失败：" + safeMessage(exception));
        }
    }

    private void applyReconciliation(R run, AdapterReconciliation result) {
        if (isBlank(result.externalId())) {
            store.markReconciliationRequired(run, "执行器返回了无效外部运行编号，请人工确认");
            return;
        }
        var status = result.status() == null
                ? new AdapterRunStatus(RunStatus.SUBMITTED.name(), "已找到外部运行，等待状态同步", null, null)
                : result.status();
        if (!store.linkReconciled(run, result.externalId(), "已找到外部运行，等待状态同步")) {
            return;
        }
        var normalized = RunStatus.normalize(status.status());
        if (normalized.terminal()) {
            finishPollTerminal(run, normalized.name(), status.message(), status.startedAt(),
                    status.finishedAt(), null);
        } else {
            store.applyStatus(run, normalized.name(), status.message(), status.startedAt(),
                    status.finishedAt(), null, null);
        }
    }

    // ---- 公用 ----

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) {
            return "未知错误";
        }
        return message.length() > 240 ? message.substring(0, 240) : message;
    }
}
