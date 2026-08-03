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

    public JobService(JobRepository repository, SourceService sourceService) {
        this.repository = repository;
        this.sourceService = sourceService;
    }

    public List<IngestionJob> list(String tenantId, String institutionId) {
        return repository.findAll(defaultValue(tenantId, "default"), defaultValue(institutionId, "demo-hospital"));
    }

    @Transactional
    public IngestionJob create(CreateJobRequest request) {
        sourceService.require(request.sourceId());
        return repository.save(new IngestionJob(
                UUID.randomUUID().toString(),
                request.sourceId(),
                request.name().trim(),
                defaultValue(request.mode(), "BATCH").toUpperCase(),
                defaultValue(request.executor(), "SEATUNNEL").toUpperCase(),
                "DRAFT",
                Instant.now(),
                null,
                null));
    }

    private String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
