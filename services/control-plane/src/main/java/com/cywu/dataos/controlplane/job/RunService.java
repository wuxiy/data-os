package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.HexFormat;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.stereotype.Service;

@Service
public class RunService {

    private static final Set<String> RETRYABLE_TERMINAL_STATUSES = Set.of(
            "FAILED", "CANCELED", "BLOCKED_CONFIGURATION", "BLOCKED_DEPENDENCY", "SUBMIT_FAILED",
            "UNSUPPORTED_EXECUTOR");

    private final JobRepository jobRepository;
    private final RunRepository runRepository;
    private final JobConfigService jobConfigService;
    private final java.util.List<ExecutorAdapter> adapters;
    private final TransactionTemplate transactions;
    private final ObjectMapper objectMapper;

    public RunService(JobRepository jobRepository,
                      RunRepository runRepository,
                      JobConfigService jobConfigService,
                      java.util.List<ExecutorAdapter> adapters,
                      PlatformTransactionManager transactionManager,
                      ObjectMapper objectMapper) {
        this.jobRepository = jobRepository;
        this.runRepository = runRepository;
        this.jobConfigService = jobConfigService;
        this.adapters = adapters;
        this.transactions = new TransactionTemplate(transactionManager);
        this.objectMapper = objectMapper;
    }

    /**
     * Claim a run in a short transaction, call the external executor outside
     * that transaction, then CAS the result back in a second short transaction.
     * The claim protects against concurrent starts without holding a database
     * row lock during a network call.
     */
    public IngestionRun start(String jobId, CreateRunRequest request, String idempotencyKey) {
        var claim = transactions.execute(status -> claim(jobId,
                request == null ? new CreateRunRequest(Map.of()) : request, idempotencyKey));
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
            var submission = adapter.submit(claim.job(), claim.config());
            if (submission == null || submission.externalId() == null || submission.externalId().isBlank()) {
                return complete(claim, "SUBMIT_FAILED", null,
                        "中心采集执行器未返回外部运行编号", null, Instant.now());
            }
            return complete(claim, "SUBMITTED", submission.externalId(), submission.message(), Instant.now(), null);
        } catch (AdapterConfigurationException exception) {
            return complete(claim, "BLOCKED_CONFIGURATION", null, exception.getMessage(), null, null);
        } catch (AdapterUnavailableException exception) {
            return complete(claim, "BLOCKED_DEPENDENCY", null, exception.getMessage(), null, null);
        } catch (RuntimeException exception) {
            return complete(claim, "SUBMIT_FAILED", null,
                    "执行器提交失败：" + safeMessage(exception), null, Instant.now());
        }
    }

    private RunClaim claim(String jobId, CreateRunRequest request, String idempotencyKey) {
        var job = jobRepository.findByIdForUpdate(jobId)
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + jobId));
        var requestKey = normalizeIdempotencyKey(idempotencyKey);
        var config = request.config().isEmpty()
                ? jobConfigService.findOptional(job.id()).map(IngestionJobConfig::config).orElse(Map.of())
                : request.config();
        var requestFingerprint = requestKey == null ? null : fingerprint(config);
        if (requestKey != null) {
            var existing = runRepository.findByRequestKey(jobId, requestKey);
            if (existing.isPresent()) {
                if (!java.util.Objects.equals(existing.get().requestFingerprint(), requestFingerprint)) {
                    throw new com.cywu.dataos.controlplane.api.ConflictException("相同 Idempotency-Key 的请求内容不一致");
                }
                return new RunClaim(null, null, Map.of(), existing.get().run());
            }
        }
        if ("PAUSED".equals(job.status())) {
            throw new ConflictException("采集任务已暂停，恢复后才能启动运行");
        }
        if ("ARCHIVED".equals(job.status())) {
            throw new ConflictException("采集任务已归档，不能启动运行");
        }
        if ("DRAFT".equals(job.status())) {
            jobRepository.updateStatus(job.id(), "ACTIVE");
            job = withStatus(job, "ACTIVE");
        }
        runRepository.findActive(jobId).ifPresent(active -> {
            throw new com.cywu.dataos.controlplane.api.ConflictException("采集作业已有运行中的记录：" + active.id());
        });

        var submittedAt = Instant.now();
        var run = new IngestionRun(
                UUID.randomUUID().toString(),
                job.id(),
                "SUBMITTING",
                job.executor(),
                null,
                "中心采集作业提交中",
                submittedAt,
                null,
                null);
        runRepository.save(run, requestKey, requestFingerprint);
        runRepository.updateJobLastRunAt(job.id(), submittedAt);
        return new RunClaim(job, run, config, null);
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

    public java.util.List<IngestionRun> list(String jobId) {
        if (jobRepository.findById(jobId).isEmpty()) {
            throw new ResourceNotFoundException("未找到采集作业：" + jobId);
        }
        return runRepository.findAll(jobId);
    }

    public IngestionRun retry(String jobId, String runId) {
        var run = runRepository.findById(jobId, runId)
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集运行记录：" + runId));
        if (!RETRYABLE_TERMINAL_STATUSES.contains(run.status())) {
            throw new ConflictException("只有失败、阻塞或取消的运行记录才能重试");
        }
        return start(jobId, new CreateRunRequest(Map.of()), "retry-" + runId + "-" + UUID.randomUUID());
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

    private record RunClaim(IngestionJob job, IngestionRun run, Map<String, Object> config, IngestionRun replay) {
    }
}
