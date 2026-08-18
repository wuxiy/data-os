package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.cywu.dataos.controlplane.run.RunStateStore;
import com.cywu.dataos.controlplane.run.RunStatus;

/**
 * 采集运行的持久化 adapter：无租约列，提交行本身即租约（单活动不变式
 * 已挡并发提交），轮询竞态由状态格条件更新自身防护。
 */
public class IngestionRunStore implements RunStateStore<IngestionRun, Void> {

    private final RunRepository runRepository;

    public IngestionRunStore(RunRepository runRepository) {
        this.runRepository = runRepository;
    }

    @Override
    public boolean claimSubmissionLease(IngestionRun run, Instant leaseUntil) {
        // SUBMITTING 行即租约：findActive FOR UPDATE 已排除并发提交。
        return true;
    }

    @Override
    public boolean completeSubmission(IngestionRun run, String status, String externalId, String message,
                                      Instant startedAt, Instant finishedAt) {
        var lastRunAt = lastRunAt(finishedAt, startedAt);
        return runRepository.completeSubmissionAndJobLastRunAt(run.id(), run.jobId(), status, externalId,
                message, startedAt, finishedAt, lastRunAt) > 0;
    }

    @Override
    public void markSubmissionRetryable(IngestionRun run, String message, Instant retryAt) {
        // 采集侧提交失败一律终态（宁可疑转对账），不存在可重试提交。
        throw new IllegalStateException("采集运行不存在可重试的提交路径");
    }

    @Override
    public List<IngestionRun> findSyncCandidates(Instant now) {
        var candidates = new java.util.ArrayList<IngestionRun>();
        candidates.addAll(runRepository.findSyncCandidates());
        candidates.addAll(runRepository.findReconciliationCandidates());
        return candidates;
    }

    @Override
    public boolean claimStatusPoll(IngestionRun run, Instant leaseUntil) {
        // 状态格条件更新自身防重，无需轮询租约。
        return true;
    }

    @Override
    public boolean applyStatus(IngestionRun run, String status, String message,
                               Instant startedAt, Instant finishedAt, Void payload, Instant nextPollAt) {
        var lastRunAt = lastRunAt(finishedAt, startedAt);
        return runRepository.updateStatusAndJobLastRunAt(run.id(), run.jobId(), status, message,
                startedAt, finishedAt, lastRunAt) > 0;
    }

    @Override
    public void markPollRetryable(IngestionRun run, String message, Instant nextPollAt) {
        runRepository.updateStatusAndJobLastRunAt(run.id(), run.jobId(), run.status(), message,
                null, null, Instant.now());
    }

    @Override
    public boolean linkReconciled(IngestionRun run, String externalId, String message) {
        return runRepository.linkReconciledRun(run.id(), externalId, RunStatus.SUBMITTED.name(),
                message, null, null) > 0;
    }

    @Override
    public void markReconciliationRequired(IngestionRun run, String message) {
        runRepository.markReconciliationRequired(run.id(), message);
    }

    @Override
    public int recoverStaleSubmissions(long leaseMillis) {
        return runRepository.recoverStaleSubmitting(leaseMillis);
    }

    @Override
    public Optional<IngestionRun> reload(IngestionRun run) {
        return runRepository.findById(run.jobId(), run.id());
    }

    private static Instant lastRunAt(Instant finishedAt, Instant startedAt) {
        return finishedAt != null ? finishedAt : startedAt != null ? startedAt : Instant.now();
    }
}
