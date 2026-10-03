package com.cywu.dataos.controlplane.source;

import com.cywu.dataos.controlplane.api.ErrorMessages;
import com.cywu.dataos.controlplane.api.InvalidRequestException;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SourceService {

    /** 连接登记只落非敏感键；明文凭据一律拒绝（本地模式也不例外，与「不落库敏感值」承诺一致）。 */
    private static final Set<String> CONNECTION_KEYS = Set.of("jdbcUrl", "username", "credentialRef");
    private static final Set<String> SENSITIVE_KEYS = Set.of("password", "secret", "token");

    private final SourceRepository repository;
    private final List<SourceCheckAdapter> checkAdapters;
    private final TenantScope tenantScope;
    private final SourceConnections connections;

    public SourceService(SourceRepository repository, List<SourceCheckAdapter> checkAdapters, TenantScope tenantScope,
                         SourceConnections connections) {
        this.repository = repository;
        this.checkAdapters = checkAdapters;
        this.tenantScope = tenantScope;
        this.connections = connections;
    }

    public List<Source> list(String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        return repository.findAll(scope.tenantId(), scope.institutionId());
    }

    @Transactional
    public Source create(CreateSourceRequest request) {
        var scope = tenantScope.resolve(request.tenantId(), request.institutionId());
        var source = new Source(
                UUID.randomUUID().toString(),
                scope.tenantId(),
                scope.institutionId(),
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
        var scope = tenantScope.current();
        return repository.findById(id, scope.tenantId(), scope.institutionId())
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
        repository.updateCheck(source.id(), source.tenantId(), source.institutionId(), result.status(),
                result.message(), Instant.now());
        return require(source.id());
    }

    private SourceCheckResult checkAdapter(SourceCheckAdapter adapter, Source source, Map<String, Object> config) {
        try {
            return adapter.check(source, config);
        } catch (RuntimeException exception) {
            return SourceCheckResult.unhealthy("数据源检查执行失败：" + ErrorMessages.safe(exception));
        }
    }

    /**
     * 登记数据源的非敏感连接配置（目录浏览与受控查询的工作连接来源）。
     * 只保留 jdbcUrl / username / credentialRef 三个键；出现明文凭据键直接拒绝。
     */
    @Transactional
    public Source saveConnection(String sourceId, SourceConnectionRequest request) {
        var source = require(sourceId);
        if (!"JDBC".equalsIgnoreCase(source.protocol())) {
            throw new InvalidRequestException("仅支持 JDBC 数据源登记连接配置：" + source.protocol());
        }
        var config = request == null || request.config() == null ? Map.<String, Object>of() : request.config();
        var jdbcUrl = text(config.get("jdbcUrl"));
        if (jdbcUrl.isBlank()) {
            throw new InvalidRequestException("连接登记需要 jdbcUrl");
        }
        try {
            connections.validateJdbcUrl(jdbcUrl);
        } catch (IllegalArgumentException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
        for (var key : SENSITIVE_KEYS) {
            if (config.containsKey(key)) {
                throw new InvalidRequestException("连接登记不保存明文凭据；密码、Secret 请经凭据服务以 credentialRef 引用");
            }
        }
        var sanitized = new LinkedHashMap<String, Object>();
        sanitized.put("jdbcUrl", jdbcUrl);
        putIfNotBlank(sanitized, "username", config.get("username"));
        putIfNotBlank(sanitized, "credentialRef", config.get("credentialRef"));
        if (!text(sanitized.get("credentialRef")).isBlank()) {
            resolveCredential(source, text(sanitized.get("credentialRef")));
        }
        repository.updateConnection(source.id(), source.tenantId(), source.institutionId(), sanitized);
        return require(sourceId);
    }

    private void resolveCredential(Source source, String credentialRef) {
        try {
            connections.resolveCredential(credentialRef, source.tenantId(), source.institutionId());
        } catch (RuntimeException exception) {
            throw new InvalidRequestException("凭据引用无法解析");
        }
    }

    private void putIfNotBlank(Map<String, Object> target, String key, Object value) {
        var text = text(value);
        if (!text.isBlank()) target.put(key, text);
    }

    private String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
