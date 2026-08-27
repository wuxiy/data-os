package com.cywu.dataos.controlplane.dataservice;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.cywu.dataos.controlplane.security.TenantScope;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * 数据服务管理面服务（G13 方案 §4.1）：定义状态机、模板静态校验、
 * Key 发放/吊销、审计查询与执行面 registry 投影。SQL 模板与参数契约
 * 的权威只在控制面；执行面 data-api 无库，经内部端点拉取。
 */
@Service
public class DataApiAdminService {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final DataServiceRepository repository;
    private final TenantScope tenantScope;

    public DataApiAdminService(DataServiceRepository repository, TenantScope tenantScope) {
        this.repository = repository;
        this.tenantScope = tenantScope;
    }

    public DataServiceDefinition create(String tenantId, CreateDataServiceRequest request) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        if (repository.existsByCode(tenantId, request.code())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "服务代码已存在: " + request.code());
        }
        var declared = new java.util.LinkedHashSet<String>();
        for (var parameter : request.parameters()) {
            declared.add(parameter.name());
        }
        var rejection = SqlTemplateValidator.validate(request.sqlTemplate(), declared);
        if (rejection != null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, rejection);
        }
        var now = Instant.now();
        var definition = new DataServiceDefinition(
                UUID.randomUUID().toString(), tenantId, request.code(), request.name(),
                request.description(), "v1", DataApiLifecycle.DRAFT, request.sqlTemplate(),
                toJson(request.parameters()), toJson(request.columns()),
                Math.max(request.maxRows(), 1), Math.max(request.timeoutSeconds(), 1),
                request.owner(), now, now);
        return repository.save(definition);
    }

    public DataServiceDefinition publish(String id, String tenantId) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        var definition = requireDefinition(id, tenantId);
        if (!definition.status().canTransitionTo(DataApiLifecycle.PUBLISHED)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "状态机拒绝: " + definition.status() + " → PUBLISHED");
        }
        repository.updateStatus(id, tenantId, DataApiLifecycle.PUBLISHED, Instant.now());
        return requireDefinition(id, tenantId);
    }

    public DataServiceDefinition deprecate(String id, String tenantId) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        var definition = requireDefinition(id, tenantId);
        if (!definition.status().canTransitionTo(DataApiLifecycle.DEPRECATED)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "状态机拒绝: " + definition.status() + " → DEPRECATED");
        }
        repository.updateStatus(id, tenantId, DataApiLifecycle.DEPRECATED, Instant.now());
        return requireDefinition(id, tenantId);
    }

    public List<DataServiceDefinition> list(String tenantId) {
        return repository.findAll(tenantId);
    }

    public DataServiceDetail detail(String id, String tenantId) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        var definition = requireDefinition(id, tenantId);
        var keys = repository.findKeys(id, tenantId).stream().map(this::keySummary).toList();
        return new DataServiceDetail(definition, keys, repository.countCallsByService(id));
    }

    /** 发放 API Key：明文只出现在本次响应，库内只存 SHA-256 与前缀。 */
    public IssuedKey issueKey(String id, String tenantId, String callerName,
                              List<String> allowedHospitals, int dailyQuota) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        requireDefinition(id, tenantId);
        var plain = "dataos_sk_" + randomHex(32);
        var key = new DataServiceKey(UUID.randomUUID().toString(), id, tenantId,
                callerName, sha256Hex(plain), plain.substring(0, 16),
                toJson(allowedHospitals == null || allowedHospitals.isEmpty()
                        ? List.of("*") : allowedHospitals),
                Math.max(dailyQuota, 1), DataServiceKey.KeyStatus.ACTIVE, Instant.now(), null, null);
        repository.saveKey(key);
        return new IssuedKey(key.id(), callerName, plain, key.dailyQuota(),
                key.allowedHospitalsJson());
    }

    public void revokeKey(String id, String keyId, String tenantId) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        if (repository.revokeKey(keyId, id, tenantId, Instant.now()) == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Key 不存在或已吊销");
        }
    }

    public List<Map<String, Object>> calls(String id, String tenantId, int limit) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        requireDefinition(id, tenantId);
        return repository.findCalls(id, tenantId, Math.min(Math.max(limit, 1), 100)).stream()
                .map(call -> Map.<String, Object>of(
                        "id", call.id(),
                        "keyId", call.keyId() == null ? "" : call.keyId(),
                        "rowCount", call.rowCount(),
                        "truncated", call.truncated(),
                        "elapsedMs", call.elapsedMs(),
                        "statusCode", call.statusCode(),
                        "calledAt", call.calledAt().toString()))
                .toList();
    }

    public Map<String, Object> overview(String tenantId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var services = repository.findAll(resolved);
        var published = services.stream().filter(s -> s.status() == DataApiLifecycle.PUBLISHED).count();
        var activeKeys = services.stream()
                .mapToLong(s -> repository.findKeys(s.id(), resolved).stream()
                        .filter(k -> k.status() == DataServiceKey.KeyStatus.ACTIVE).count())
                .sum();
        return Map.of(
                "total", services.size(),
                "published", published,
                "draft", services.size() - published,
                "activeKeys", activeKeys,
                "callsToday", repository.countCallsSince(LocalDate.now().atStartOfDay().toInstant(UTC)));
    }

    // ---- 内部面（执行面 data-api 专用） ----

    /** 发布定义 + 有效 Key + 当日用量投影；吊销在 30s 缓存窗口后生效。 */
    public Map<String, Object> registry() {
        var services = repository.findPublished();
        var usage = new LinkedHashMap<String, Integer>();
        for (var row : repository.dailyUsageByKeyHash(LocalDate.now())) {
            usage.put(row[0], Integer.parseInt(row[1]));
        }
        var serviceIds = services.stream().map(DataServiceDefinition::id).toList();
        var keys = serviceIds.isEmpty() ? List.<DataServiceKey>of() : repository.findActiveKeys(serviceIds);
        var keyEntries = keys.stream().map(key -> Map.<String, Object>of(
                "serviceCode", serviceCodeOf(services, key.serviceId()),
                "keyHash", key.keyHash(),
                "callerName", key.callerName(),
                "allowedHospitals", key.allowedHospitalsJson(),
                "dailyQuota", key.dailyQuota(),
                "usedToday", usage.getOrDefault(key.keyHash(), 0))).toList();
        return Map.of(
                "services", services.stream().map(definition -> Map.<String, Object>of(
                        "code", definition.code(),
                        "name", definition.name(),
                        "description", definition.description(),
                        "version", definition.versionSn(),
                        "sqlTemplate", definition.sqlTemplate(),
                        "parameters", definition.parametersJson(),
                        "columns", definition.columnsJson(),
                        "maxRows", definition.maxRows(),
                        "timeoutSeconds", definition.timeoutSeconds())).toList(),
                "keys", keyEntries);
    }

    /** 审计回写（执行面调用，idempotency_key 幂等）。 */
    public boolean recordCall(String code, String keyHash, String parametersJson, int rowCount,
                              boolean truncated, int elapsedMs, int statusCode, String idempotencyKey) {
        var definition = repository.findPublishedByCode(code).orElse(null);
        if (definition == null) {
            return false;
        }
        var keyId = repository.findKeyByHash(keyHash)
                .filter(key -> key.status() == DataServiceKey.KeyStatus.ACTIVE)
                .map(DataServiceKey::id).orElse(null);
        if (keyId != null) {
            repository.touchKey(keyHash, Instant.now());
        }
        var call = new DataServiceCall(UUID.randomUUID().toString(), definition.id(),
                definition.tenantId(), keyId, idempotencyKey == null || idempotencyKey.isBlank()
                        ? UUID.randomUUID().toString() : idempotencyKey,
                parametersJson, rowCount, truncated, elapsedMs, statusCode, Instant.now());
        return repository.saveCall(call);
    }

    private DataServiceDefinition requireDefinition(String id, String tenantId) {
        return repository.findById(id, tenantId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "数据服务不存在: " + id));
    }

    private Map<String, Object> keySummary(DataServiceKey key) {
        return Map.of(
                "id", key.id(),
                "callerName", key.callerName(),
                "keyPrefix", key.keyPrefix(),
                "allowedHospitals", key.allowedHospitalsJson(),
                "dailyQuota", key.dailyQuota(),
                "status", key.status().name(),
                "createdAt", key.createdAt().toString(),
                "lastUsedAt", key.lastUsedAt() == null ? "" : key.lastUsedAt().toString());
    }

    private String serviceCodeOf(List<DataServiceDefinition> services, String serviceId) {
        return services.stream().filter(s -> s.id().equals(serviceId))
                .map(DataServiceDefinition::code).findFirst().orElse("");
    }

    private String toJson(Object value) {
        try {
            return JSON.writeValueAsString(value);
        } catch (Exception exception) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "契约结构无法序列化");
        }
    }

    static String sha256Hex(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 不可用", exception);
        }
    }

    private static String randomHex(int bytes) {
        var buffer = new byte[bytes];
        RANDOM.nextBytes(buffer);
        return HexFormat.of().formatHex(buffer);
    }

    private static final java.time.ZoneOffset UTC = java.time.ZoneOffset.UTC;

    public record DataServiceDetail(DataServiceDefinition service, List<Map<String, Object>> keys, long totalCalls) {
    }

    public record IssuedKey(String keyId, String callerName, String apiKey, int dailyQuota,
                            String allowedHospitalsJson) {
    }
}
