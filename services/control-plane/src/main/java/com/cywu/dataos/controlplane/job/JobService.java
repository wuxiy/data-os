package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.cywu.dataos.controlplane.source.SourceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class JobService {

    private final JobRepository repository;
    private final SourceService sourceService;
    private final JobConfigService configService;
    private final TenantScope tenantScope;

    public JobService(JobRepository repository, SourceService sourceService, JobConfigService configService,
                      TenantScope tenantScope) {
        this.repository = repository;
        this.sourceService = sourceService;
        this.configService = configService;
        this.tenantScope = tenantScope;
    }

    public List<IngestionJob> list(String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        return repository.findAll(scope.tenantId(), scope.institutionId());
    }

    @Transactional
    public IngestionJob create(CreateJobRequest request) {
        sourceService.require(request.sourceId());
        var job = repository.save(new IngestionJob(
                UUID.randomUUID().toString(),
                request.sourceId(),
                request.name().trim(),
                defaultValue(request.mode(), "BATCH").toUpperCase(),
                defaultValue(request.executor(), "SEATUNNEL").toUpperCase(),
                "DRAFT",
                Instant.now(),
                null,
                null,
                null,
                null,
                false));
        if (!request.config().isEmpty()) {
            configService.save(job.id(), new SaveJobConfigRequest(
                    request.templateKey() == null || request.templateKey().isBlank()
                            ? "CUSTOM_JSON" : request.templateKey(),
                    request.templateVersion(), request.config()));
        }
        var scope = tenantScope.current();
        return repository.findById(job.id(), scope.tenantId(), scope.institutionId()).orElse(job);
    }

    @Transactional
    public IngestionJob changeStatus(String jobId, UpdateJobStatusRequest request) {
        var scope = tenantScope.current();
        var job = repository.findById(jobId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + jobId));
        var target = JobLifecycle.normalize(request.status());
        if (JobLifecycle.ARCHIVED.equals(job.status()) && !JobLifecycle.ARCHIVED.equals(target)) {
            throw new ConflictException("已归档的采集任务不能恢复或修改状态");
        }
        repository.updateStatus(jobId, scope.tenantId(), scope.institutionId(), target);
        return repository.findById(jobId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + jobId));
    }

    /**
     * 任务复制（G2G 批次 1 第二刀）：结构化任务把意图重定向到目标源并重新对着
     * 目标源实校验/编译（跨源复用采集口径）；JSON 任务原样复制配置。副本一律
     * 以 DRAFT 落库，不继承运行历史与状态。
     */
    @Transactional
    public IngestionJob copy(String jobId, CopyJobRequest request) {
        var scope = tenantScope.current();
        var job = repository.findById(jobId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + jobId));
        var targetSourceId = request != null && request.sourceId() != null && !request.sourceId().isBlank()
                ? request.sourceId().trim() : job.sourceId();
        sourceService.require(targetSourceId);
        var name = request != null && request.name() != null && !request.name().isBlank()
                ? request.name().trim() : job.name() + "-副本";
        var copy = repository.save(new IngestionJob(
                UUID.randomUUID().toString(),
                targetSourceId,
                name,
                job.mode(),
                job.executor(),
                "DRAFT",
                Instant.now(),
                null,
                null,
                null,
                null,
                false));
        configService.findOptional(jobId).ifPresent(config -> {
            if (config.structured() != null) {
                var spec = StructuredTaskSpec.fromMap(config.structured());
                var retargeted = new StructuredTaskSpec(spec.form(), targetSourceId, spec.catalog(),
                        spec.tables(), spec.columns(), spec.orderKey(), spec.mode(), spec.customSql(),
                        spec.targetDatabase(), spec.targetTable(), spec.sinkFenodes(), spec.sinkCredentialRef());
                configService.saveStructured(copy.id(), retargeted);
            } else {
                configService.save(copy.id(), new SaveJobConfigRequest(
                        config.templateKey(), config.templateVersion(), config.config()));
            }
        });
        return repository.findById(copy.id(), scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + copy.id()));
    }

    private String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
