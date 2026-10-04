package com.cywu.dataos.controlplane.edge;

import java.net.InetSocketAddress;
import java.net.Socket;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ErrorMessages;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.job.JobConfigTree;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.cywu.dataos.controlplane.source.SourceNetworkPolicy;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 前置机节点管理（G2G 批次 4）：台账 CRUD + 中心侧 TCP 可达性探测。
 *
 * <p>状态由最近一次探测衍生（ONLINE/OFFLINE/UNKNOWN）；无 agent 心跳通道
 * （MiNiFi 路线不含上报），如实以中心探活为准。主机校验复用数据源网络
 * 策略（SSRF 防护同一条防线）。
 */
@Service
public class EdgeNodeService {

    /** config 白名单键：非敏感运维描述（中转前缀/采集流标识/说明）。 */
    private static final Set<String> CONFIG_KEYS = Set.of(
            "relayPrefix", "flowName", "description", "siteLabel");
    private static final Duration PROBE_TIMEOUT = Duration.ofSeconds(3);

    private final EdgeNodeRepository repository;
    private final SourceNetworkPolicy networkPolicy;
    private final TenantScope tenantScope;

    public EdgeNodeService(EdgeNodeRepository repository, SourceNetworkPolicy networkPolicy,
                           TenantScope tenantScope) {
        this.repository = repository;
        this.networkPolicy = networkPolicy;
        this.tenantScope = tenantScope;
    }

    public List<EdgeNode> list() {
        var scope = tenantScope.current();
        return repository.findAll(scope.tenantId(), scope.institutionId());
    }

    @Transactional
    public EdgeNode save(String nodeId, SaveEdgeNodeRequest request) {
        var scope = tenantScope.current();
        String id = nodeId == null || nodeId.isBlank() ? UUID.randomUUID().toString() : nodeId.trim();
        var existing = repository.findById(id, scope.tenantId(), scope.institutionId()).orElse(null);
        if (existing == null && nodeId != null && !nodeId.isBlank()) {
            throw new ResourceNotFoundException("未找到前置机节点：" + nodeId);
        }
        var host = request.host().trim();
        try {
            networkPolicy.validateHostPort(host + ":" + request.port());
        } catch (IllegalArgumentException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
        var config = sanitizeConfig(request.config());
        var node = new EdgeNode(id, scope.tenantId(), scope.institutionId(),
                request.name().trim(),
                text(request.groupName(), "默认分组"), text(request.site(), ""),
                host, request.port(), text(request.version(), ""),
                existing == null ? null : existing.lastProbeAt(),
                existing == null ? null : existing.lastProbeOk(),
                existing == null ? null : existing.lastProbeMessage(),
                config,
                existing == null ? Instant.now() : existing.createdAt(),
                Instant.now(), null);
        repository.save(node);
        return require(id, scope);
    }

    /** 同步 TCP 探测并回写最近一次结果。 */
    public EdgeNode probe(String nodeId) {
        var scope = tenantScope.current();
        var node = require(nodeId, scope);
        var ok = false;
        String message;
        try (var socket = new Socket()) {
            socket.connect(new InetSocketAddress(node.host(), node.port()), (int) PROBE_TIMEOUT.toMillis());
            ok = true;
            message = "端口可达（" + PROBE_TIMEOUT.toSeconds() + "s 内完成连接）";
        } catch (Exception exception) {
            message = "探测失败：" + ErrorMessages.safe(exception);
        }
        repository.updateProbe(node.id(), node.tenantId(), node.institutionId(), ok, message, Instant.now());
        return require(nodeId, scope);
    }

    @Transactional
    public void delete(String nodeId) {
        var scope = tenantScope.current();
        if (repository.delete(nodeId.trim(), scope.tenantId(), scope.institutionId()) != 1) {
            throw new ResourceNotFoundException("未找到前置机节点：" + nodeId);
        }
    }

    private Map<String, Object> sanitizeConfig(Map<String, Object> config) {
        if (config == null || config.isEmpty()) return Map.of();
        if (JobConfigTree.containsSecretKey(config)) {
            throw new InvalidRequestException("前置机参数不得包含明文密码或密钥，请使用凭据引用");
        }
        var sanitized = new java.util.LinkedHashMap<String, Object>();
        for (var key : CONFIG_KEYS) {
            var value = config.get(key);
            if (value != null && !String.valueOf(value).isBlank()) {
                sanitized.put(key, String.valueOf(value).trim());
            }
        }
        for (var entry : config.entrySet()) {
            var key = normalizeKey(entry.getKey());
            if (key != null && !sanitized.containsKey(key) && entry.getValue() != null) {
                var text = String.valueOf(entry.getValue()).trim();
                if (!text.isBlank()) sanitized.put(key, text);
            }
        }
        return sanitized;
    }

    private String normalizeKey(String raw) {
        var parts = raw.trim().split("[_\\-\\s]+");
        if (parts.length == 0) return null;
        var builder = new StringBuilder(parts[0].toLowerCase(Locale.ROOT));
        for (var index = 1; index < parts.length; index++) {
            if (parts[index].isEmpty()) continue;
            builder.append(Character.toUpperCase(parts[index].charAt(0)))
                    .append(parts[index].substring(1).toLowerCase(Locale.ROOT));
        }
        var key = builder.toString();
        return CONFIG_KEYS.contains(key) ? key : null;
    }

    private EdgeNode require(String nodeId, TenantScope.Scope scope) {
        return repository.findById(nodeId.trim(), scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到前置机节点：" + nodeId));
    }

    private String text(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
