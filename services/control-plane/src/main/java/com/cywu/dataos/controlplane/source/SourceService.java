package com.cywu.dataos.controlplane.source;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SourceService {

    private final SourceRepository repository;
    private final List<SourceCheckAdapter> checkAdapters;

    public SourceService(SourceRepository repository, List<SourceCheckAdapter> checkAdapters) {
        this.repository = repository;
        this.checkAdapters = checkAdapters;
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
                Instant.now(),
                null,
                null);
        return repository.save(source);
    }

    public Source require(String id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("未找到数据源：" + id));
    }

    public Source check(String sourceId, SourceCheckRequest request) {
        var source = require(sourceId);
        var config = request == null ? Map.<String, Object>of() : request.config();
        var adapter = checkAdapters.stream()
                .filter(item -> item.supports(source.protocol()))
                .findFirst()
                .orElse(null);
        var result = adapter == null
                ? SourceCheckResult.blockedConfiguration("暂不支持该协议的可用性检查：" + source.protocol())
                : checkAdapter(adapter, source, config);
        repository.updateCheck(source.id(), result.status(), result.message(), Instant.now());
        return require(source.id());
    }

    private SourceCheckResult checkAdapter(SourceCheckAdapter adapter, Source source, Map<String, Object> config) {
        try {
            return adapter.check(source, config);
        } catch (RuntimeException exception) {
            return SourceCheckResult.unhealthy("数据源检查执行失败：" + safeMessage(exception));
        }
    }

    private String safeMessage(RuntimeException exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) return "未知错误";
        return message.length() > 240 ? message.substring(0, 240) : message;
    }

    private String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
