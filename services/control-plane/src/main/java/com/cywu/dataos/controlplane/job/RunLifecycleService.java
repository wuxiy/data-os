package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterSubmissionUnknownException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import com.cywu.dataos.controlplane.executor.AdapterRunStatus;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.stereotype.Service;

@Service
public class RunLifecycleService {

    private static final Set<String> RETRYABLE_TERMINAL_STATUSES = Set.of(
        "FAILED", "CANCELED", "BLOCKED_CONFIGURATION", "BLOCKED_DEPENDENCY", "SUBMIT_FAILED",
            "UNSUPPORTED_EXECUTOR", "UNKNOWN");

    private final JobRepository jobRepository;
    private final RunRepository runRepository;
    private final JobConfigService jobConfigService;
    private final List<ExecutorAdapter> adapters;
    private final TransactionTemplate transactions;
    private final ObjectMapper objectMapper;
    private final JobConfigurationPolicy configurationPolicy;
    private final TenantScope tenantScope;
    private final IngestionCheckpointRepository checkpointRepository;
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();

    public RunLifecycleService(JobRepository jobRepository,
                               RunRepository runRepository,
                               JobConfigService jobConfigService,
                               List<ExecutorAdapter> adapters,
                               PlatformTransactionManager transactionManager,
                               ObjectMapper objectMapper,
                               JobConfigurationPolicy configurationPolicy,
                               TenantScope tenantScope,
                               IngestionCheckpointRepository checkpointRepository) {
        this.jobRepository = jobRepository;
        this.runRepository = runRepository;
        this.jobConfigService = jobConfigService;
        this.adapters = adapters;
        this.transactions = new TransactionTemplate(transactionManager);
        this.objectMapper = objectMapper;
        this.configurationPolicy = configurationPolicy;
        this.tenantScope = tenantScope;
        this.checkpointRepository = checkpointRepository;
    }

    /**
     * Claim a run in a short transaction, call the external executor outside
     * that transaction, then CAS the result back in a second short transaction.
     * The claim protects against concurrent starts without holding a database
     * row lock during a network call.
     */
    public IngestionRun start(String jobId, CreateRunRequest request, String idempotencyKey) {
        var scope = tenantScope.current();
        var claim = transactions.execute(status -> claim(jobId,
                request == null ? new CreateRunRequest(Map.of()) : request, idempotencyKey, scope));
        if (claim == null) {
            throw new IllegalStateException("采集运行占位记录未创建");
        }
        if (claim.replay() != null) return claim.replay();

        var adapter = adapters.stream().filter(item -> item.supports(claim.job().executor())).findFirst().orElse(null);
        if (adapter == null) {
            return complete(claim, "UNSUPPORTED_EXECUTOR", null,
                    "暂不支持执行器：" + claim.job().executor(), null, null);
        }

        try {
            var submission = adapter.submit(claim.job(), claim.config(), claim.run().id());
            if (submission == null || submission.externalId() == null || submission.externalId().isBlank()) {
                return complete(claim, "UNKNOWN", null,
                        "中心采集执行器未返回外部运行编号，需按 data_os_run_id 对账", null, null);
            }
            return complete(claim, "SUBMITTED", submission.externalId(), submission.message(), Instant.now(), null);
        } catch (AdapterConfigurationException exception) {
            return complete(claim, "BLOCKED_CONFIGURATION", null, exception.getMessage(), null, null);
        } catch (AdapterSubmissionUnknownException exception) {
            return complete(claim, "UNKNOWN", null, exception.getMessage(), null, null);
        } catch (AdapterUnavailableException exception) {
            return complete(claim, "BLOCKED_DEPENDENCY", null, exception.getMessage(), null, null);
        } catch (RuntimeException exception) {
            return complete(claim, "SUBMIT_FAILED", null,
                    "执行器提交失败：" + safeMessage(exception), null, Instant.now());
        }
    }

    private RunClaim claim(String jobId, CreateRunRequest request, String idempotencyKey,
                           TenantScope.Scope scope) {
        var job = jobRepository.findByIdForUpdate(jobId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + jobId));
        var requestKey = normalizeIdempotencyKey(idempotencyKey);
        var savedConfig = jobConfigService.findOptional(job.id()).map(IngestionJobConfig::config);
        var config = savedConfig.orElse(Map.of());
        // A run may only execute the last persisted, validated configuration.
        // The request body is retained solely for idempotency compatibility and
        // must be byte-equivalent (canonical JSON) to that saved configuration.
        var fingerprintConfig = request.config().isEmpty() ? config : request.config();
        var requestFingerprint = requestKey == null ? null : fingerprint(fingerprintConfig);
        if (requestKey != null) {
            var existing = runRepository.findByRequestKey(jobId, requestKey);
            if (existing.isPresent()) {
                if (!Objects.equals(existing.get().requestFingerprint(), requestFingerprint)) {
                    throw new ConflictException("相同 Idempotency-Key 的请求内容不一致");
                }
                return new RunClaim(null, null, Map.of(), existing.get().run(), null, null);
            }
        }
        if (!request.config().isEmpty()) {
            if (savedConfig.isEmpty()) {
                throw new ConflictException("采集任务尚未保存配置，不能通过运行请求临时注入配置");
            }
            if (!fingerprint(savedConfig.get()).equals(fingerprint(request.config()))) {
                throw new ConflictException("运行请求配置必须与任务已保存配置完全一致");
            }
        }
        configurationPolicy.validateRun(job, config);
        if ("PAUSED".equals(job.status())) {
            throw new ConflictException("采集任务已暂停，恢复后才能启动运行");
        }
        if ("ARCHIVED".equals(job.status())) {
            throw new ConflictException("采集任务已归档，不能启动运行");
        }
        if ("DRAFT".equals(job.status())) {
            jobRepository.updateStatus(job.id(), scope.tenantId(), scope.institutionId(), "ACTIVE");
            job = withStatus(job, "ACTIVE");
        }
        runRepository.findActive(jobId).ifPresent(active -> {
            throw new ConflictException("采集作业已有运行中的记录：" + active.id());
        });

        var submittedAt = Instant.now();
        var runId = UUID.randomUUID().toString();
        var watermarkStart = checkpointRepository.findLastSuccessWatermark(job.id()).orElse(Instant.parse("1970-01-01T00:00:00Z"));
        // Capture an upper bound before the source query starts. Advancing to
        // the external executor's finish time would skip rows committed while
        // the query was already running.
        var watermarkEnd = submittedAt;
        config = interpolateConfig(config, watermarkStart, watermarkEnd, runId);
        var run = new IngestionRun(
                runId,
                job.id(),
                "SUBMITTING",
                job.executor(),
                null,
                "中心采集作业提交中",
                submittedAt,
                null,
                null);
        runRepository.save(run, requestKey, requestFingerprint);
        runRepository.setSourceWatermarkStart(runId, watermarkStart);
        runRepository.setSourceWatermarkEndBoundary(runId, watermarkEnd);
        runRepository.updateJobLastRunAt(job.id(), submittedAt);
        return new RunClaim(job, run, config, null, watermarkStart, watermarkEnd);
    }

    private Map<String, Object> interpolateConfig(Map<String, Object> source, Instant watermarkStart,
                                                   Instant watermarkEnd, String runId) {
        var value = interpolateNode(source, watermarkStart, watermarkEnd, runId);
        if (!(value instanceof Map<?, ?> map)) return Map.of();
        var result = new HashMap<String, Object>();
        map.forEach((key, item) -> result.put(String.valueOf(key), item));
        var env = result.get("env");
        var resolvedEnv = new HashMap<String, Object>();
        if (env instanceof Map<?, ?> envMap) {
            envMap.forEach((key, item) -> resolvedEnv.put(String.valueOf(key), item));
        }
        resolvedEnv.put("dataos_run_id", runId);
        resolvedEnv.put("dataos.watermark.start",
                watermarkStart == null ? "1970-01-01T00:00:00Z" : watermarkStart.toString());
        resolvedEnv.put("dataos.watermark.end",
                watermarkEnd == null ? Instant.now().toString() : watermarkEnd.toString());
        result.put("env", resolvedEnv);
        return result;
    }

    private Object interpolateNode(Object value, Instant watermarkStart, Instant watermarkEnd, String runId) {
        if (value instanceof Map<?, ?> map) {
            var result = new HashMap<String, Object>();
            map.forEach((key, item) -> result.put(String.valueOf(key),
                    interpolateNode(item, watermarkStart, watermarkEnd, runId)));
            return result;
        }
        if (value instanceof java.util.Collection<?> collection) {
            return collection.stream().map(item -> interpolateNode(item, watermarkStart, watermarkEnd, runId)).toList();
        }
        if (value instanceof String text) {
            return text.replace("${last_success_time}",
                            watermarkStart == null ? "1970-01-01T00:00:00Z" : watermarkStart.toString())
                    .replace("${run_start_time}",
                            watermarkEnd == null ? Instant.now().toString() : watermarkEnd.toString())
                    .replace("${data_os_run_id}", runId);
        }
        return value;
    }

    private IngestionRun complete(RunClaim claim, String status, String externalId, String message,
                                  Instant startedAt, Instant finishedAt) {
        var result = transactions.execute(transaction -> {
            var lastRunAt = finishedAt != null ? finishedAt : startedAt != null ? startedAt : Instant.now();
            runRepository.completeSubmissionAndJobLastRunAt(claim.run().id(), claim.run().jobId(), status,
                    externalId, message, startedAt, finishedAt, lastRunAt);
            return runRepository.findById(claim.run().jobId(), claim.run().id()).orElse(new IngestionRun(
                    claim.run().id(), claim.run().jobId(), status, claim.run().executor(), externalId, message,
                    claim.run().submittedAt(), startedAt, finishedAt));
        });
        return result == null ? new IngestionRun(
                claim.run().id(), claim.run().jobId(), status, claim.run().executor(), externalId, message,
                claim.run().submittedAt(), startedAt, finishedAt) : result;
    }

    private String normalizeIdempotencyKey(String value) {
        if (value == null || value.isBlank()) return null;
        var normalized = value.trim();
        if (normalized.length() > 128) {
            throw new InvalidRequestException("Idempotency-Key 不能超过 128 个字符");
        }
        return normalized;
    }

    public List<IngestionRun> list(String jobId) {
        var scope = tenantScope.current();
        if (jobRepository.findById(jobId, scope.tenantId(), scope.institutionId()).isEmpty()) {
            throw new ResourceNotFoundException("未找到采集作业：" + jobId);
        }
        return runRepository.findAll(jobId, scope.tenantId(), scope.institutionId());
    }

    public IngestionRun retry(String jobId, String runId) {
        var scope = tenantScope.current();
        var run = runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集运行记录：" + runId));
        if (!RETRYABLE_TERMINAL_STATUSES.contains(run.status())) {
            throw new ConflictException("只有失败、阻塞或取消的运行记录才能重试");
        }
        if ("UNKNOWN".equals(run.status()) && !"CONFIRMED_ABSENT".equals(run.reconciliationStatus())) {
            throw new ConflictException("外部运行尚未完成对账；请确认不存在后再重试");
        }
        return start(jobId, new CreateRunRequest(Map.of()), "retry-" + runId + "-" + UUID.randomUUID());
    }

    void syncPendingRuns(long submitLeaseMs) {
        if (submitLeaseMs < 1) {
            throw new IllegalArgumentException("提交租约必须为正数");
        }
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
        transactions.executeWithoutResult(transaction -> {
            var updated = runRepository.updateStatusAndJobLastRunAt(run.id(), run.jobId(), status, message, startedAt,
                    finishedAt, lastRunAt);
            if (updated > 0 && "SUCCEEDED".equals(status) && checkpointRepository != null) {
                var watermarkEnd = runRepository.findSourceWatermarkEnd(run.id())
                        .orElse(finishedAt != null ? finishedAt : lastRunAt);
                runRepository.setSourceWatermarkEndBoundary(run.id(), watermarkEnd);
                checkpointRepository.advance(run.jobId(), run.id(), watermarkEnd);
            }
        });
    }

    private boolean isSyncable(IngestionRun run) {
        var hasExternalId = run.externalId() != null && !run.externalId().isBlank();
        return (hasExternalId && ("SUBMITTED".equals(run.status()) || "RUNNING".equals(run.status())
                || "UNKNOWN".equals(run.status())))
                || (!hasExternalId && "UNKNOWN".equals(run.status())
                && (run.reconciliationStatus() == null || "MANUAL_REQUIRED".equals(run.reconciliationStatus())));
    }

    private void reconcileOne(IngestionRun run, ExecutorAdapter adapter) {
        var result = adapter.reconcile(run.id());
        if (result == null) {
            runRepository.markReconciliationRequired(run.id(), "执行器未返回对账结果，请人工确认");
            return;
        }
        switch (result.outcome()) {
            case FOUND -> {
                var externalId = result.externalId();
                if (externalId == null || externalId.isBlank()) {
                    runRepository.markReconciliationRequired(run.id(), "执行器返回了无效外部运行编号，请人工确认");
                    return;
                }
                var status = result.status() == null
                        ? new AdapterRunStatus("SUBMITTED", "已找到外部运行，等待状态同步", null, null)
                        : result.status();
                var linked = runRepository.linkReconciledRun(run.id(), externalId, "SUBMITTED",
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
        if (message == null || message.isBlank()) {
            return "未知错误";
        }
        return message.length() > 240 ? message.substring(0, 240) : message;
    }

    private IngestionJob withStatus(IngestionJob job, String status) {
        return new IngestionJob(job.id(), job.sourceId(), job.name(), job.mode(), job.executor(), status,
                job.createdAt(), job.latestRunStatus(), job.lastRunAt(), job.templateKey(), job.templateVersion(),
                job.configured());
    }

    private String fingerprint(Map<String, Object> config) {
        try {
            var canonical = objectMapper.writer()
                    .with(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
                    .writeValueAsBytes(config);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical));
        } catch (JsonProcessingException | NoSuchAlgorithmException exception) {
            throw new IllegalStateException("运行请求无法生成幂等指纹", exception);
        }
    }

    private record RunClaim(IngestionJob job, IngestionRun run, Map<String, Object> config,
                            IngestionRun replay, Instant watermarkStart, Instant watermarkEnd) {
    }
}
