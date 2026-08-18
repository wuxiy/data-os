package com.cywu.dataos.controlplane.run;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

import com.cywu.dataos.controlplane.executor.AdapterReconciliation;
import com.cywu.dataos.controlplane.executor.AdapterRunStatus;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 通过模块自身 interface 的单测：内存 RunStateStore + 脚本化执行器会话。
 * 两个 adapter（内存 store 与真实仓储）证明 seam 为真。
 */
class ExternalRunLifecycleTest {

    // ---- 测试脚手架 ----

    static final class TestRun implements ExternalRun {
        final String runId;
        String statusCode;
        String externalRunId;
        String executorName = "TEST";
        String recon;
        Instant nextPoll;
        int attempts;

        TestRun(String runId, String statusCode, String externalRunId) {
            this.runId = runId;
            this.statusCode = statusCode;
            this.externalRunId = externalRunId;
        }

        @Override
        public String id() {
            return runId;
        }

        @Override
        public String status() {
            return statusCode;
        }

        @Override
        public String externalId() {
            return externalRunId;
        }

        @Override
        public String executor() {
            return executorName;
        }

        @Override
        public Instant nextPollAt() {
            return nextPoll;
        }

        @Override
        public int attemptCount() {
            return attempts;
        }

        @Override
        public String reconciliationStatus() {
            return recon;
        }
    }

    static final class InMemoryStore implements RunStateStore<TestRun, String> {
        final Map<String, TestRun> runs = new ConcurrentHashMap<>();
        final List<String> calls = new ArrayList<>();
        int staleSweeps;
        /** 模拟采集侧仓储才实现过期清扫；质量侧沿用接口默认空实现。 */
        boolean sweepStaleSubmissions;

        void put(TestRun run) {
            runs.put(run.id(), run);
        }

        @Override
        public boolean claimSubmissionLease(TestRun run, Instant leaseUntil) {
            calls.add("claimSubmit");
            return true;
        }

        @Override
        public boolean completeSubmission(TestRun run, String status, String externalId, String message,
                                          Instant startedAt, Instant finishedAt) {
            calls.add("complete:" + status);
            var current = runs.get(run.id());
            if (!"SUBMITTING".equals(current.status())) return false;
            current.statusCode = status;
            if (RunStatus.SUBMITTED.name().equals(status)) {
                current.externalRunId = externalId;
            }
            return true;
        }

        @Override
        public void markSubmissionRetryable(TestRun run, String message, Instant retryAt) {
            calls.add("submitRetryable");
            var current = runs.get(run.id());
            current.attempts += 1;
            current.nextPoll = retryAt;
        }

        @Override
        public List<TestRun> findSyncCandidates(Instant now) {
            return runs.values().stream()
                    .filter(run -> !run.terminal())
                    .filter(run -> run.nextPollAt() == null || !run.nextPollAt().isAfter(now))
                    .toList();
        }

        @Override
        public boolean claimStatusPoll(TestRun run, Instant leaseUntil) {
            calls.add("claimPoll");
            return true;
        }

        @Override
        public boolean applyStatus(TestRun run, String status, String message, Instant startedAt,
                                   Instant finishedAt, String payload, Instant nextPollAt) {
            calls.add("apply:" + status);
            var current = runs.get(run.id());
            if (current.terminal()) return false;
            current.statusCode = status;
            current.nextPoll = nextPollAt;
            return true;
        }

        @Override
        public void markPollRetryable(TestRun run, String message, Instant nextPollAt) {
            calls.add("pollRetryable");
            runs.get(run.id()).nextPoll = nextPollAt;
        }

        @Override
        public boolean linkReconciled(TestRun run, String externalId, String message) {
            calls.add("link");
            var current = runs.get(run.id());
            current.externalRunId = externalId;
            current.recon = "FOUND";
            return true;
        }

        @Override
        public void markReconciliationRequired(TestRun run, String message) {
            calls.add("reconcileRequired");
            var current = runs.get(run.id());
            current.statusCode = RunStatus.UNKNOWN.name();
            current.recon = "MANUAL_REQUIRED";
        }

        @Override
        public int recoverStaleSubmissions(long leaseMillis) {
            if (!sweepStaleSubmissions) return 0;
            staleSweeps += 1;
            // 与采集侧仓储同语义：过期 SUBMITTING 转 UNKNOWN、清空对账状态，
            // 等待按内部编号对账或人工确认。
            for (var run : runs.values()) {
                if (RunStatus.SUBMITTING.name().equals(run.status())) {
                    run.statusCode = RunStatus.UNKNOWN.name();
                    run.recon = null;
                }
            }
            return 0;
        }

        @Override
        public Optional<TestRun> reload(TestRun run) {
            return Optional.ofNullable(runs.get(run.id()));
        }
    }

    static final class ScriptedSession implements ExternalExecutorPort.ExecutorSession<TestRun, String, String> {
        final List<String> calls = new ArrayList<>();
        Supplier<ExternalSubmission> submitScript = () -> new ExternalSubmission("ext-1", "已接受");
        Supplier<ExternalStatus<String>> statusScript =
                () -> new ExternalStatus<>("RUNNING", "执行中", null, null, null);
        Supplier<AdapterReconciliation> reconcileScript =
                () -> AdapterReconciliation.manualRequired("不支持对账");

        @Override
        public ExternalSubmission submit(TestRun run, String command) {
            calls.add("submit");
            return submitScript.get();
        }

        @Override
        public ExternalStatus<String> status(TestRun run) {
            calls.add("status");
            return statusScript.get();
        }

        @Override
        public AdapterReconciliation reconcile(TestRun run) {
            calls.add("reconcile");
            return reconcileScript.get();
        }
    }

    static final class RecordingEffects implements RunTerminalEffects<TestRun, String> {
        final List<String> calls = new ArrayList<>();

        @Override
        public void onTerminal(TestRun run, String status, String payload, Instant startedAt, Instant finishedAt) {
            calls.add("terminal:" + status + ":" + payload);
        }

        @Override
        public void onSubmissionFailed(TestRun run, String status, String message) {
            calls.add("submitFailed:" + status);
        }
    }

    static final class RecordingTransactionManager implements PlatformTransactionManager {
        final List<String> events = new ArrayList<>();

        @Override
        public TransactionStatus getTransaction(TransactionDefinition definition) {
            events.add("begin");
            return new SimpleTransactionStatus();
        }

        @Override
        public void commit(TransactionStatus status) {
            events.add("commit");
        }

        @Override
        public void rollback(TransactionStatus status) {
            events.add("rollback");
        }
    }

    private static RunPolicy resubmitPolicy() {
        return new RunPolicy(StaleSubmissionPolicy.RESUBMIT_BACKOFF, true, true,
                "SUBMIT_FAILED", "SUBMIT_FAILED", null, "SUBMIT_FAILED", "SUBMIT_FAILED", "SUBMIT_FAILED",
                "", "暂不支持质量规则执行器：%s", "质量规则执行器未返回外部批次编号",
                "FAILED", true, "FAILED", false, false, 30_000, 120_000);
    }

    private static RunPolicy ingestionPolicy() {
        return new RunPolicy(StaleSubmissionPolicy.MARK_UNKNOWN_RECONCILE, false, false,
                "UNSUPPORTED_EXECUTOR", "UNKNOWN", "UNKNOWN", "BLOCKED_CONFIGURATION", "BLOCKED_DEPENDENCY",
                "SUBMIT_FAILED", "执行器提交失败：", "暂不支持执行器：%s",
                "中心采集执行器未返回外部运行编号，需按 data_os_run_id 对账",
                "UNKNOWN", false, "FAILED", true, true, 30_000, 120_000);
    }

    private static ExternalRunLifecycle<TestRun, String, String> lifecycle(
            InMemoryStore store, ScriptedSession session, RecordingEffects effects,
            RecordingTransactionManager transactions, RunPolicy policy) {
        return new ExternalRunLifecycle<>(store, run -> Optional.of(session), effects,
                run -> Optional.of("command"), policy, transactions);
    }

    // ---- 提交阶段 ----

    @Test
    void launchRunsClaimInTransactionThenSubmitsOutsideIt() {
        var store = new InMemoryStore();
        var session = new ScriptedSession();
        var effects = new RecordingEffects();
        var transactions = new RecordingTransactionManager();
        var lifecycle = lifecycle(store, session, effects, transactions, resubmitPolicy());

        var result = lifecycle.launch(() -> {
            var run = new TestRun("run-1", "SUBMITTING", null);
            store.put(run);
            return ExternalRunLifecycle.ClaimOutcome.pending(run, "command");
        });

        assertThat(result.status()).isEqualTo("SUBMITTED");
        assertThat(result.externalId()).isEqualTo("ext-1");
        assertThat(transactions.events).containsExactly("begin", "commit", "begin", "commit");
        assertThat(effects.calls).isEmpty();
    }

    @Test
    void replayClaimShortCircuitsWithoutExecutor() {
        var store = new InMemoryStore();
        var session = new ScriptedSession();
        var lifecycle = lifecycle(store, session, new RecordingEffects(),
                new RecordingTransactionManager(), resubmitPolicy());
        var existing = new TestRun("run-1", "SUCCEEDED", "ext-1");

        var result = lifecycle.launch(() -> ExternalRunLifecycle.ClaimOutcome.replay(existing));

        assertThat(result).isSameAs(existing);
        assertThat(session.calls).isEmpty();
    }

    @Test
    void unavailableSubmitStaysSubmittingWithBackoff() {
        var store = new InMemoryStore();
        store.put(new TestRun("run-1", "SUBMITTING", null));
        var session = new ScriptedSession();
        session.submitScript = () -> {
            throw new AdapterUnavailableException("执行器不可达");
        };
        var effects = new RecordingEffects();
        var lifecycle = lifecycle(store, session, effects, new RecordingTransactionManager(), resubmitPolicy());

        var result = lifecycle.launch(() -> ExternalRunLifecycle.ClaimOutcome.pending(
                store.runs.get("run-1"), "command"));

        assertThat(result.status()).isEqualTo("SUBMITTING");
        assertThat(result.nextPollAt()).isAfter(Instant.now());
        assertThat(effects.calls).isEmpty();
    }

    @Test
    void terminalSubmitFailureRunsEffectsInsideWriteTransaction() {
        var store = new InMemoryStore();
        store.put(new TestRun("run-1", "SUBMITTING", null));
        var session = new ScriptedSession();
        session.submitScript = () -> {
            throw new IllegalStateException("boom");
        };
        var effects = new RecordingEffects();
        var transactions = new RecordingTransactionManager();
        var lifecycle = lifecycle(store, session, effects, transactions, resubmitPolicy());

        var result = lifecycle.launch(() -> ExternalRunLifecycle.ClaimOutcome.pending(
                store.runs.get("run-1"), "command"));

        assertThat(result.status()).isEqualTo("SUBMIT_FAILED");
        assertThat(transactions.events).containsExactly("begin", "commit", "begin", "commit");
        assertThat(store.calls).contains("complete:SUBMIT_FAILED");
        assertThat(effects.calls).containsExactly("submitFailed:SUBMIT_FAILED");
    }

    // ---- 轮询阶段 ----

    @Test
    void terminalStatusAppliesPayloadAndEffectsInOneTransaction() {
        var store = new InMemoryStore();
        store.put(new TestRun("run-1", "SUBMITTED", "ext-1"));
        var session = new ScriptedSession();
        session.statusScript = () -> new ExternalStatus<>("SUCCEEDED", "复检通过",
                Instant.now(), Instant.now(), "payload-9");
        var effects = new RecordingEffects();
        var transactions = new RecordingTransactionManager();
        var lifecycle = lifecycle(store, session, effects, transactions, resubmitPolicy());

        lifecycle.syncPending();

        assertThat(store.runs.get("run-1").status()).isEqualTo("SUCCEEDED");
        assertThat(store.calls).contains("apply:SUCCEEDED");
        assertThat(effects.calls).containsExactly("terminal:SUCCEEDED:payload-9");
        assertThat(transactions.events).containsExactly("begin", "commit");
    }

    @Test
    void ingestionPolicyRetainsStatusOnTemporaryPollFailure() {
        var store = new InMemoryStore();
        store.put(new TestRun("run-1", "RUNNING", "ext-1"));
        var session = new ScriptedSession();
        session.statusScript = () -> {
            throw new IllegalStateException("timeout");
        };
        var lifecycle = lifecycle(store, session, new RecordingEffects(),
                new RecordingTransactionManager(), ingestionPolicy());

        lifecycle.syncOne(store.runs.get("run-1"));

        assertThat(store.runs.get("run-1").status()).isEqualTo("RUNNING");
        assertThat(store.calls).contains("apply:RUNNING");
    }

    @Test
    void resubmitPolicyRecordsBackoffOnTemporaryPollFailure() {
        var store = new InMemoryStore();
        store.put(new TestRun("run-1", "RUNNING", "ext-1"));
        var session = new ScriptedSession();
        session.statusScript = () -> {
            throw new IllegalStateException("timeout");
        };
        var lifecycle = lifecycle(store, session, new RecordingEffects(),
                new RecordingTransactionManager(), resubmitPolicy());

        lifecycle.syncPending();

        assertThat(store.runs.get("run-1").status()).isEqualTo("RUNNING");
        assertThat(store.calls).contains("pollRetryable");
    }

    // ---- 恢复与对账 ----

    @Test
    void ingestionPolicySweepsStaleSubmissionsInsteadOfResubmitting() {
        var store = new InMemoryStore();
        store.sweepStaleSubmissions = true;
        store.put(new TestRun("run-1", "SUBMITTING", null));
        var session = new ScriptedSession();
        var lifecycle = lifecycle(store, session, new RecordingEffects(),
                new RecordingTransactionManager(), ingestionPolicy());

        lifecycle.syncPending();

        assertThat(store.staleSweeps).isEqualTo(1);
        // 清扫后按内部编号对账（不支持时转人工），绝不重投。
        assertThat(session.calls).containsExactly("reconcile");
        assertThat(session.calls).doesNotContain("submit");
    }

    @Test
    void resubmitPolicyRecoversSubmittingRunByCommand() {
        var store = new InMemoryStore();
        store.put(new TestRun("run-1", "SUBMITTING", null));
        var session = new ScriptedSession();
        var lifecycle = lifecycle(store, session, new RecordingEffects(),
                new RecordingTransactionManager(), resubmitPolicy());

        lifecycle.syncPending();

        assertThat(session.calls).containsExactly("submit");
        assertThat(store.runs.get("run-1").status()).isEqualTo("SUBMITTED");
    }

    @Test
    void reconciliationFoundLinksExternalIdAndAppliesStatus() {
        var store = new InMemoryStore();
        store.put(new TestRun("run-1", "UNKNOWN", null));
        var session = new ScriptedSession();
        session.reconcileScript = () -> AdapterReconciliation.found("ext-9",
                new AdapterRunStatus("RUNNING", "已找到外部运行", null, null), "found");
        var lifecycle = lifecycle(store, session, new RecordingEffects(),
                new RecordingTransactionManager(), ingestionPolicy());

        lifecycle.syncOne(store.runs.get("run-1"));

        assertThat(store.runs.get("run-1").externalId()).isEqualTo("ext-9");
        assertThat(store.runs.get("run-1").status()).isEqualTo("RUNNING");
        assertThat(store.calls).contains("link", "apply:RUNNING");
    }

    // ---- 状态词汇 ----

    @Test
    void normalizesExecutorAliasesToUnifiedVocabulary() {
        assertThat(RunStatus.normalize("PENDING")).isEqualTo(RunStatus.SUBMITTED);
        assertThat(RunStatus.normalize("STARTED")).isEqualTo(RunStatus.RUNNING);
        assertThat(RunStatus.normalize("PASSED")).isEqualTo(RunStatus.SUCCEEDED);
        assertThat(RunStatus.normalize("CANCELLED")).isEqualTo(RunStatus.CANCELED);
        assertThat(RunStatus.normalize(null)).isEqualTo(RunStatus.UNKNOWN);
        assertThat(RunStatus.normalize("WEIRD")).isEqualTo(RunStatus.UNKNOWN);
        // 已归一的中性值原样通过。
        assertThat(RunStatus.normalize("SUCCEEDED")).isEqualTo(RunStatus.SUCCEEDED);
        assertThat(RunStatus.normalize("SUBMIT_FAILED")).isEqualTo(RunStatus.SUBMIT_FAILED);
        assertThat(RunStatus.normalize("BLOCKED_CONFIGURATION")).isEqualTo(RunStatus.BLOCKED_CONFIGURATION);
    }
}
