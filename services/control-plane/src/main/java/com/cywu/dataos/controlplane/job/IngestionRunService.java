package com.cywu.dataos.controlplane.job;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import com.cywu.dataos.controlplane.run.ExternalRunLifecycle;
import com.cywu.dataos.controlplane.run.RunPolicy;
import com.cywu.dataos.controlplane.run.RunStatus;
import com.cywu.dataos.controlplane.run.StaleSubmissionPolicy;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * 采集侧外部运行的接入方：幂等领取（Idempotency-Key + 配置指纹）、单
 * 活动运行不变式、任务生命周期校验与水位线插值在此；提交-轮询-对账
 * 状态机由 run 包生命周期模块拥有（领域定义见 CONTEXT.md「外部运行」）。
 */
@Service
public class IngestionRunService {

    private final JobRepository jobRepository;
    private final RunRepository runRepository;
    private final JobConfigService jobConfigService;
    private final JobConfigurationPolicy configurationPolicy;
    private final TenantScope tenantScope;
    private final IngestionCheckpointRepository checkpointRepository;
    private final ObjectMapper objectMapper;
    private final ExternalRunLifecycle<IngestionRun, IngestionSubmission, Void> lifecycle;

    public IngestionRunService(JobRepository jobRepository,
                               RunRepository runRepository,
                               JobConfigService jobConfigService,
                               List<ExecutorAdapter> adapters,
                               PlatformTransactionManager transactionManager,
                               ObjectMapper objectMapper,
                               JobConfigurationPolicy configurationPolicy,
                               TenantScope tenantScope,
                               IngestionCheckpointRepository checkpointRepository,
                               @Value("${data-os.runs.sync-interval-ms:30000}") long syncIntervalMs,
                               @Value("${data-os.runs.submit-lease-ms:120000}") long submitLeaseMs) {
        this.jobRepository = jobRepository;
        this.runRepository = runRepository;
        this.jobConfigService = jobConfigService;
        this.configurationPolicy = configurationPolicy;
        this.tenantScope = tenantScope;
        this.checkpointRepository = checkpointRepository;
        this.objectMapper = objectMapper;
        this.lifecycle = new ExternalRunLifecycle<>(
                new IngestionRunStore(runRepository),
                new IngestionExecutorPort(adapters),
                new IngestionRunEffects(runRepository, checkpointRepository),
                run -> Optional.empty(),
                ingestionPolicy(syncIntervalMs, submitLeaseMs),
                transactionManager);
    }

    /** 采集侧行为声明：外部写入不可重入，提交失败一律终态、宁可疑转对账。 */
    private static RunPolicy ingestionPolicy(long syncIntervalMs, long submitLeaseMs) {
        return new RunPolicy(
                StaleSubmissionPolicy.MARK_UNKNOWN_RECONCILE,
                false,
                false,
                "UNSUPPORTED_EXECUTOR",
                "UNKNOWN",
                "UNKNOWN",
                "BLOCKED_CONFIGURATION",
                "BLOCKED_DEPENDENCY",
                "SUBMIT_FAILED",
                "执行器提交失败：",
                "暂不支持执行器：%s",
                "中心采集执行器未返回外部运行编号，需按 data_os_run_id 对账",
                "UNKNOWN",
                false,
                "FAILED",
                true,
                true,
                syncIntervalMs,
                submitLeaseMs);
    }

    public IngestionRun start(String jobId, CreateRunRequest request, String idempotencyKey) {
        var scope = tenantScope.current();
        var safeRequest = request == null ? new CreateRunRequest(Map.of()) : request;
        return lifecycle.launch(() -> claim(jobId, safeRequest, idempotencyKey, scope));
    }

    /**
     * 领取业务规则（在生命周期模块的短事务内执行）：幂等重放、配置一致
     * 性、任务生命周期与单活动不变式、水位线插值，落一条 SUBMITTING 行。
     */
    private ExternalRunLifecycle.ClaimOutcome<IngestionRun, IngestionSubmission> claim(
            String jobId, CreateRunRequest request, String idempotencyKey, TenantScope.Scope scope) {
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
                return ExternalRunLifecycle.ClaimOutcome.replay(existing.get().run());
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
        var watermarkStart = checkpointRepository.findLastSuccessWatermark(job.id())
                .orElse(Instant.parse("1970-01-01T00:00:00Z"));
        // Capture an upper bound before the source query starts. Advancing to
        // the external executor's finish time would skip rows committed while
        // the query was already running.
        var watermarkEnd = submittedAt;
        config = interpolateConfig(config, watermarkStart, watermarkEnd, runId);
        var run = new IngestionRun(
                runId,
                job.id(),
                RunStatus.SUBMITTING.name(),
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
        return ExternalRunLifecycle.ClaimOutcome.pending(run, new IngestionSubmission(job, config));
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
        if (!RunStatus.RETRYABLE_TERMINAL.contains(run.status())) {
            throw new ConflictException("只有失败、阻塞或取消的运行记录才能重试");
        }
        if (RunStatus.UNKNOWN.name().equals(run.status())
                && !"CONFIRMED_ABSENT".equals(run.reconciliationStatus())) {
            throw new ConflictException("外部运行尚未完成对账；请确认不存在后再重试");
        }
        return start(jobId, new CreateRunRequest(Map.of()), "retry-" + runId + "-" + UUID.randomUUID());
    }

    public void syncPending() {
        lifecycle.syncPending();
    }

    public IngestionRun sync(String jobId, String runId) {
        var scope = tenantScope.current();
        var run = runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集运行记录：" + runId));
        lifecycle.syncOne(run);
        return runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId()).orElse(run);
    }

    public IngestionRun confirmAbsent(String jobId, String runId) {
        var scope = tenantScope.current();
        var run = runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集运行记录：" + runId));
        if (!RunStatus.UNKNOWN.name().equals(run.status())
                || !"MANUAL_REQUIRED".equals(run.reconciliationStatus())) {
            throw new ConflictException("当前运行不处于待人工确认状态，不能确认外部运行不存在");
        }
        if (runRepository.confirmAbsent(run.id(), "人工确认外部运行不存在，允许重新投递") != 1) {
            throw new ConflictException("运行状态已变化，请刷新后重试");
        }
        return runRepository.findById(jobId, runId, scope.tenantId(), scope.institutionId()).orElse(run);
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
}
