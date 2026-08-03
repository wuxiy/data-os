package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.source.SourceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class JobService {

    private final JobRepository repository;
    private final SourceService sourceService;
    private final JobConfigService configService;

    public JobService(JobRepository repository, SourceService sourceService, JobConfigService configService) {
        this.repository = repository;
        this.sourceService = sourceService;
        this.configService = configService;
    }

    public List<IngestionJob> list(String tenantId, String institutionId) {
        return repository.findAll(defaultValue(tenantId, "default"), defaultValue(institutionId, "demo-hospital"));
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
        return repository.findById(job.id()).orElse(job);
    }

    private String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
