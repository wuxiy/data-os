package com.cywu.dataos.controlplane.job;

import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.time.Instant;

import jakarta.annotation.PostConstruct;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.cywu.dataos.controlplane.security.AuthProperties;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class RunStatusSyncService {

    private final RunRepository runRepository;
    private final List<ExecutorAdapter> adapters;
    private final TenantScope tenantScope;
    private final IngestionCheckpointRepository checkpointRepository;
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    @Value("${data-os.runs.sync-interval-ms:30000}")
    private long syncIntervalMs;

    @Value("${data-os.runs.sync-initial-delay-ms:10000}")
    private long syncInitialDelayMs;

    @Value("${data-os.runs.submit-lease-ms:120000}")
    private long submitLeaseMs;

    @Autowired
    public RunStatusSyncService(RunRepository runRepository, List<ExecutorAdapter> adapters, TenantScope tenantScope,
                                IngestionCheckpointRepository checkpointRepository) {
        this.runRepository = runRepository;
        this.adapters = adapters;
        this.tenantScope = tenantScope;
        this.checkpointRepository = checkpointRepository;
    }

    public RunStatusSyncService(RunRepository runRepository, List<ExecutorAdapter> adapters) {
        this(runRepository, adapters, new TenantScope(new AuthProperties()), null);
    }

    @PostConstruct
    void validateSchedule() {
        if (syncIntervalMs < 1000 || syncIntervalMs > 3_600_000) {
            throw new IllegalStateException("data-os.runs.sync-interval-ms 必须在 1000 到 3600000 毫秒之间");
        }
        if (syncInitialDelayMs < 0 || syncInitialDelayMs > 3_600_000) {
            throw new IllegalStateException("data-os.runs.sync-initial-delay-ms 必须在 0 到 3600000 毫秒之间");
        }
        if (submitLeaseMs < 1000 || submitLeaseMs > 86_400_000) {
            throw new IllegalStateException("data-os.runs.submit-lease-ms 必须在 1000 到 86400000 毫秒之间");
        }
    }

    @Scheduled(
            fixedDelayString = "${data-os.runs.sync-interval-ms:30000}",
            initialDelayString = "${data-os.runs.sync-initial-delay-ms:10000}")
    public void scheduledSync() {
        syncPendingRuns();
    }

    public void syncPendingRuns() {
        runRepository.recoverStaleSubmitting(submitLeaseMs);
        runRepository.findSyncCandidates().forEach(this::syncOne);
        runRepository.findReconciliationCandidates().forEach(this::syncOne);
    }

    public IngestionRun sync(String jobId, String runId) {
        var scope = tenantScope.current();
        var run = runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集运行记录：" + runId));
        if (!isSyncable(run)) {
            return run;
        }
        syncOne(run);
        return runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId()).orElse(run);
    }

    public IngestionRun confirmAbsent(String jobId, String runId) {
        var scope = tenantScope.current();
        var run = runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集运行记录：" + runId));
        if (!"UNKNOWN".equals(run.status()) || !"MANUAL_REQUIRED".equals(run.reconciliationStatus())) {
            throw new ConflictException("当前运行不处于待人工确认状态，不能确认外部运行不存在");
        }
        if (runRepository.confirmAbsent(run.id(), "人工确认外部运行不存在，允许重新投递") != 1) {
            throw new ConflictException("运行状态已变化，请刷新后重试");
        }
        return runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId()).orElse(run);
    }

    private void syncOne(IngestionRun run) {
        if (!isSyncable(run) || !inFlight.add(run.id())) return;

        try {
            var adapter = adapters.stream()
                    .filter(item -> item.supports(run.executor()))
                    .findFirst()
                    .orElse(null);
            if (adapter == null) {
                updateStatus(run, "UNKNOWN", "暂不支持执行器：" + run.executor(), null, null);
                return;
            }

            if (run.externalId() == null || run.externalId().isBlank()) {
                reconcileOne(run, adapter);
            } else {
                var status = adapter.status(run.externalId());
                updateStatus(run, status.status(), status.message(), status.startedAt(), status.finishedAt());
            }
        } catch (AdapterConfigurationException | AdapterUnavailableException exception) {
            if (run.externalId() == null || run.externalId().isBlank()) {
                runRepository.markReconciliationRequired(run.id(), exception.getMessage());
            } else {
                var targetStatus = exception instanceof AdapterConfigurationException ? "FAILED" : run.status();
                updateStatus(run, targetStatus, exception.getMessage(), null, null);
            }
        } catch (RuntimeException exception) {
            if (run.externalId() == null || run.externalId().isBlank()) {
                runRepository.markReconciliationRequired(run.id(), "对账失败：" + safeMessage(exception));
            } else {
                updateStatus(run, run.status(), "状态同步失败：" + safeMessage(exception), null, null);
            }
        } finally {
            inFlight.remove(run.id());
        }
    }

    private void updateStatus(IngestionRun run, String status, String message, Instant startedAt, Instant finishedAt) {
        var lastRunAt = finishedAt != null ? finishedAt : startedAt != null ? startedAt : Instant.now();
        var updated = runRepository.updateStatusAndJobLastRunAt(run.id(), run.jobId(), status, message, startedAt,
                finishedAt, lastRunAt);
        if (updated > 0 && "SUCCEEDED".equals(status) && checkpointRepository != null) {
            // Prefer the upper bound captured before extraction. Falling back
            // to finish time is only for runs created before V3, otherwise a
            // slow run could advance past rows committed while its query ran.
            var watermarkEnd = runRepository.findSourceWatermarkEnd(run.id())
                    .orElse(finishedAt != null ? finishedAt : lastRunAt);
            runRepository.setSourceWatermarkEndBoundary(run.id(), watermarkEnd);
            checkpointRepository.advance(run.jobId(), run.id(), watermarkEnd);
        }
    }

    private boolean isSyncable(IngestionRun run) {
        var hasExternalId = run.externalId() != null && !run.externalId().isBlank();
        return (hasExternalId && ("SUBMITTED".equals(run.status()) || "RUNNING".equals(run.status())
                || "UNKNOWN".equals(run.status())))
                || (!hasExternalId && "UNKNOWN".equals(run.status())
                && "MANUAL_REQUIRED".equals(run.reconciliationStatus()));
    }

    private void reconcileOne(IngestionRun run, ExecutorAdapter adapter) {
        var result = adapter.reconcile(run.id());
        if (result == null) {
            runRepository.markReconciliationRequired(run.id(), "执行器未返回对账结果，请人工确认");
            return;
        }
        switch (result.outcome()) {
            case FOUND -> {
                var status = result.status() == null
                        ? new com.cywu.dataos.controlplane.executor.AdapterRunStatus(
                        "SUBMITTED", "已找到外部运行，等待状态同步", null, null)
                        : result.status();
                // First bind the external id while the row is still UNKNOWN.
                // The normal conditional status update can then advance the
                // row from SUBMITTED to a terminal state without losing the
                // compare-and-set guard after reconciliation.
                var linked = runRepository.linkReconciledRun(run.id(), result.externalId(), "SUBMITTED",
                        "已找到外部运行，等待状态同步", null, null);
                if (linked > 0) {
                    updateStatus(run, status.status(), status.message(), status.startedAt(), status.finishedAt());
                }
            }
            case NOT_FOUND -> runRepository.markReconciliationRequired(run.id(),
                    result.message() == null ? "未找到外部运行，请人工确认不存在后再重试" : result.message());
            case MANUAL_REQUIRED -> runRepository.markReconciliationRequired(run.id(),
                    result.message() == null ? "执行器无法可靠对账，请人工确认" : result.message());
        }
    }

    private String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) return "未知错误";
        return message.length() > 240 ? message.substring(0, 240) : message;
    }
}
