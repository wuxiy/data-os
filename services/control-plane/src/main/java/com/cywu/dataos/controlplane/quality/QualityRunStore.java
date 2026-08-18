package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.cywu.dataos.controlplane.governance.IssueRepository;
import com.cywu.dataos.controlplane.run.RunCommandSource;
import com.cywu.dataos.controlplane.run.RunStateStore;
import com.cywu.dataos.controlplane.run.RunStatus;

/**
 * 质量复检运行的持久化 adapter：用租约列（submit/status lease、
 * next_poll_at）编码生命周期端口语义。错误终态不清空既有证据与
 * 通过标记，走 last_error 通道。
 */
public class QualityRunStore implements RunStateStore<QualityRuleRun, QualityResultPayload> {

    private final QualityRunRepository runs;
    private final long pollIntervalMs;
    private final String workerId = "quality-worker-" + UUID.randomUUID();

    public QualityRunStore(QualityRunRepository runs, long pollIntervalMs) {
        this.runs = runs;
        this.pollIntervalMs = pollIntervalMs;
    }

    /** 恢复重投的命令源：所属治理问题已不存在时直接标记孤儿终态并放弃。 */
    public static RunCommandSource<QualityRuleRun, QualityRuleExecutionRequest> recoveryCommandSource(
            IssueRepository issues, QualityRunRepository runs) {
        return run -> {
            var issue = issues.findIssue(run.issueId(), run.tenantId(), run.institutionId());
            if (issue.isEmpty()) {
                runs.markOrphanQualityRunSubmissionError(run.id(),
                        "治理问题已不存在，无法恢复质量复检投递", Instant.now());
                return Optional.empty();
            }
            var value = issue.get();
            return Optional.of(new QualityRuleExecutionRequest(value.id(), run.tenantId(),
                    run.institutionId(), value.title(), value.ruleId(), value.datasetId(),
                    run.executionBatchId()));
        };
    }

    @Override
    public boolean claimSubmissionLease(QualityRuleRun run, Instant leaseUntil) {
        return runs.claimQualityRunForSubmission(run.id(), workerId, leaseUntil, Instant.now()) == 1;
    }

    @Override
    public boolean completeSubmission(QualityRuleRun run, String status, String externalId, String message,
                                      Instant startedAt, Instant finishedAt) {
        if (RunStatus.SUBMITTED.name().equals(status)) {
            return runs.markQualityRunSubmitted(run.id(), workerId, externalId, message,
                    Instant.now().plusMillis(pollIntervalMs)) == 1;
        }
        return runs.markQualityRunSubmissionError(run.id(), workerId, message, null, status) == 1;
    }

    @Override
    public void markSubmissionRetryable(QualityRuleRun run, String message, Instant retryAt) {
        runs.markQualityRunSubmissionError(run.id(), workerId, message, retryAt);
    }

    @Override
    public List<QualityRuleRun> findSyncCandidates(Instant now) {
        return runs.findQualitySyncCandidates(now);
    }

    @Override
    public boolean claimStatusPoll(QualityRuleRun run, Instant leaseUntil) {
        return runs.claimQualityRunForStatus(run.id(), workerId + ":status", leaseUntil, Instant.now(),
                run.status(), run.externalId()) == 1;
    }

    @Override
    public boolean applyStatus(QualityRuleRun run, String status, String message, Instant startedAt,
                               Instant finishedAt, QualityResultPayload payload, Instant nextPollAt) {
        if (payload == null && RunStatus.isTerminal(status)) {
            return runs.markQualityRunError(run.id(), message, null, status,
                    run.status(), run.externalId(), workerId + ":status") == 1;
        }
        return runs.updateQualityRunStatus(run.id(), status,
                payload == null ? null : payload.passed(),
                payload == null ? null : payload.executionBatchId(),
                message,
                payload == null ? null : payload.sampleEvidence(),
                payload == null ? null : payload.artifactUri(),
                startedAt, finishedAt, nextPollAt, null,
                run.status(), run.externalId(), workerId + ":status") == 1;
    }

    @Override
    public void markPollRetryable(QualityRuleRun run, String message, Instant nextPollAt) {
        runs.markQualityRunError(run.id(), message, nextPollAt, null,
                run.status(), run.externalId(), workerId + ":status");
    }

    @Override
    public boolean linkReconciled(QualityRuleRun run, String externalId, String message) {
        throw new IllegalStateException("质量复检运行不存在按内部编号对账的路径");
    }

    @Override
    public void markReconciliationRequired(QualityRuleRun run, String message) {
        throw new IllegalStateException("质量复检运行不存在按内部编号对账的路径");
    }

    @Override
    public Optional<QualityRuleRun> reload(QualityRuleRun run) {
        return runs.findQualityRun(run.id(), run.issueId(), run.tenantId(), run.institutionId());
    }
}
