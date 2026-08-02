package com.cywu.dataos.controlplane.source;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SourceService {

    private final SourceRepository repository;

    public SourceService(SourceRepository repository) {
        this.repository = repository;
    }

    public List<Source> list(String tenantId, String institutionId) {
        return repository.findAll(defaultValue(tenantId, "default"), defaultValue(institutionId, "demo-hospital"));
    }

    @Transactional
    public Source create(CreateSourceRequest request) {
        var source = new Source(
                UUID.randomUUID().toString(),
                defaultValue(request.tenantId(), "default"),
                defaultValue(request.institutionId(), "demo-hospital"),
                request.name().trim(),
                request.systemType().trim().toUpperCase(),
                request.protocol().trim().toUpperCase(),
                "PENDING",
                Instant.now());
        return repository.save(source);
    }

    public Source require(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("未找到数据源：" + id));
    }

    private String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
