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

    private String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
