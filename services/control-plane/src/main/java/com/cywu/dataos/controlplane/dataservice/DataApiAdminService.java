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
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import org.springframework.stereotype.Service;

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
    private final ContractNotificationRepository contracts;
    private final ContractWebhookEndpointPolicy webhookPolicy;

    public DataApiAdminService(DataServiceRepository repository, TenantScope tenantScope,
                               ContractNotificationRepository contracts,
                               ContractWebhookEndpointPolicy webhookPolicy) {
        this.repository = repository;
        this.tenantScope = tenantScope;
        this.contracts = contracts;
        this.webhookPolicy = webhookPolicy;
    }

    public DataServiceDefinition create(String tenantId, CreateDataServiceRequest request) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        if (repository.existsByCode(tenantId, request.code())) {
            throw new ConflictException("服务代码已存在: " + request.code());
        }
        var declared = new java.util.LinkedHashSet<String>();
        for (var parameter : request.parameters()) {
            declared.add(parameter.name());
        }
        var rejection = SqlTemplateValidator.validate(request.sqlTemplate(), declared);
        if (rejection != null) {
            throw new InvalidRequestException(rejection);
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
            throw new ConflictException(
                    "状态机拒绝: " + definition.status() + " → PUBLISHED");
        }
        repository.updateStatus(id, tenantId, DataApiLifecycle.PUBLISHED, Instant.now());
        recordContractEvent(id, definition, "PUBLISHED", definition.versionSn(),
                definition.versionSn(), null);
        return requireDefinition(id, tenantId);
    }

    public DataServiceDefinition deprecate(String id, String tenantId) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        var definition = requireDefinition(id, tenantId);
        if (!definition.status().canTransitionTo(DataApiLifecycle.DEPRECATED)) {
            throw new ConflictException(
                    "状态机拒绝: " + definition.status() + " → DEPRECATED");
        }
        repository.updateStatus(id, tenantId, DataApiLifecycle.DEPRECATED, Instant.now());
        recordContractEvent(id, definition, "DEPRECATED", definition.versionSn(),
                definition.versionSn(), null);
        return requireDefinition(id, tenantId);
    }

    /**
     * 更新定义（P8 余项）：null 字段不变更。DRAFT 自由修改；DEPRECATED 拒改；
     * PUBLISHED 存在实际变更时自增合同版本并产出 UPDATED 事件（diff 只含
     * 变化字段），无变更时幂等返回不产生事件。
     */
    public DataServiceDefinition update(String id, String tenantId, UpdateDataServiceRequest request) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        if (request.isEmpty()) {
            return requireDefinition(id, tenantId);
        }
        var definition = requireDefinition(id, tenantId);
        if (definition.status() == DataApiLifecycle.DEPRECATED) {
            throw new ConflictException("已下线的服务不可修改（合同封存）");
        }
        var name = request.name() == null ? definition.name() : request.name().trim();
        var description = request.description() == null ? definition.description() : request.description();
        var sqlTemplate = request.sqlTemplate() == null ? definition.sqlTemplate() : request.sqlTemplate();
        var parametersJson = request.parameters() == null
                ? definition.parametersJson() : toJson(request.parameters());
        var columnsJson = request.columns() == null
                ? definition.columnsJson() : toJson(request.columns());
        var maxRows = request.maxRows() == null ? definition.maxRows()
                : Math.min(Math.max(request.maxRows(), 1), 10000);
        var timeoutSeconds = request.timeoutSeconds() == null ? definition.timeoutSeconds()
                : Math.min(Math.max(request.timeoutSeconds(), 1), 120);
        if (request.sqlTemplate() != null || request.parameters() != null) {
            var declared = new java.util.LinkedHashSet<String>();
            for (var parameter : request.parameters() == null ? List.<CreateDataServiceRequest.ParameterContract>of()
                    : request.parameters()) {
                declared.add(parameter.name());
            }
            var rejection = SqlTemplateValidator.validate(sqlTemplate, declared);
            if (rejection != null) {
                throw new InvalidRequestException(rejection);
            }
        }
        var diff = contractDiff(definition, name, description, sqlTemplate,
                parametersJson, columnsJson, maxRows, timeoutSeconds);
        var newVersion = definition.versionSn();
        if (definition.status() == DataApiLifecycle.PUBLISHED && !diff.isEmpty()) {
            newVersion = bumpVersion(definition.versionSn());
        }
        var updated = repository.updateDefinition(id, tenantId, name, description, sqlTemplate,
                parametersJson, columnsJson, maxRows, timeoutSeconds, newVersion, Instant.now());
        if (definition.status() == DataApiLifecycle.PUBLISHED && !diff.isEmpty()) {
            recordContractEvent(id, definition, "UPDATED", definition.versionSn(), newVersion,
                    toJson(diff));
        }
        return updated;
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
            throw new ConflictException("Key 不存在或已吊销");
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
                // 当日窗口与 usedToday（dailyUsageByKeyHash 的本地午夜口径）对齐：
                // 原实现把本地日期墙钟当 UTC 午夜，00:00-08:00 CST 会漏计当日调用。
                "callsToday", repository.countCallsSince(
                        LocalDate.now().atStartOfDay(java.time.ZoneId.systemDefault()).toInstant()));
    }

    // ---- 内部面（执行面 data-api 专用） ----

    /** 发布定义 + 有效 Key + 当日用量投影；吊销在 30s 缓存窗口后生效。
     *  DEPRECATED 服务的 Key 保留在 keys（标 serviceStatus）且契约进
     *  deprecatedServices——自助面（/v1/me、合同事件轮询）是调用方获知
     *  下线的通道，其认证语义是 Key 身份而非「服务在售」；执行面查询仍
     *  只认 services（PUBLISHED）。 */
    public Map<String, Object> registry() {
        var services = repository.findPublished();
        var deprecatedServices = repository.findDeprecated();
        var usage = new LinkedHashMap<String, Integer>();
        for (var row : repository.dailyUsageByKeyHash(LocalDate.now())) {
            usage.put(row[0], Integer.parseInt(row[1]));
        }
        var serviceIds = services.stream().map(DataServiceDefinition::id).toList();
        var deprecatedIds = deprecatedServices.stream().map(DataServiceDefinition::id).toList();
        var allIds = new java.util.ArrayList<String>(serviceIds);
        deprecatedIds.forEach(allIds::add);
        var keys = allIds.isEmpty() ? List.<DataServiceKey>of() : repository.findActiveKeys(allIds);
        var codes = new java.util.HashMap<String, String>();
        services.forEach(item -> codes.put(item.id(), item.code()));
        deprecatedServices.forEach(item -> codes.putIfAbsent(item.id(), item.code()));
        var keyEntries = keys.stream().map(key -> {
            var entry = new LinkedHashMap<String, Object>();
            entry.put("serviceCode", codes.getOrDefault(key.serviceId(), ""));
            entry.put("serviceStatus", serviceIds.contains(key.serviceId())
                    ? "PUBLISHED" : "DEPRECATED");
            entry.put("keyHash", key.keyHash());
            entry.put("callerName", key.callerName());
            entry.put("allowedHospitals", key.allowedHospitalsJson());
            entry.put("dailyQuota", key.dailyQuota());
            entry.put("usedToday", usage.getOrDefault(key.keyHash(), 0));
            return entry;
        }).toList();
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
                "deprecatedServices", deprecatedServices.stream().map(definition -> Map.<String, Object>of(
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
        return recordCall(code, keyHash, parametersJson, rowCount, truncated, elapsedMs,
                statusCode, idempotencyKey, "query");
    }

    /** 审计回写（带形态：query / export——导出完成同样计入配额窗口）。 */
    public boolean recordCall(String code, String keyHash, String parametersJson, int rowCount,
                              boolean truncated, int elapsedMs, int statusCode, String idempotencyKey,
                              String kind) {
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
                parametersJson, rowCount, truncated, elapsedMs, statusCode, Instant.now(), kind);
        return repository.saveCall(call);
    }

    // ---- 导出任务（P7，H3）：任务状态机由控制面持有，执行面经内部端点驱动 ----

    public DataServiceExport createExport(String code, String keyHash, String parametersJson) {
        var definition = repository.findPublishedByCode(code)
                .orElseThrow(() -> new InvalidRequestException("服务不存在或未发布: " + code));
        var now = Instant.now();
        return repository.saveExport(new DataServiceExport(UUID.randomUUID().toString(),
                definition.id(), definition.tenantId(), keyHash,
                DataServiceExport.ExportStatus.PENDING, parametersJson, 0, null, null, null,
                now, now, null));
    }

    /** RUNNING 认领（CAS）：仅 PENDING 可转入，并发双认领安全。 */
    public boolean claimExport(String id) {
        return repository.claimExport(id, Instant.now());
    }

    public boolean finalizeExport(String id, DataServiceExport.ExportStatus target, long rowCount,
                                  Long fileBytes, String artifactUri, String error, Instant expiresAt) {
        var current = repository.findExport(id).orElse(null);
        if (current == null) {
            return false;
        }
        if (!current.status().canTransitionTo(target)) {
            throw new ConflictException("状态机拒绝: " + current.status() + " → " + target);
        }
        return repository.finalizeExport(id, target, rowCount, fileBytes, artifactUri, error,
                expiresAt, Instant.now());
    }

    public java.util.Optional<DataServiceExport> findExport(String id) {
        return repository.findExport(id);
    }

    /** 启动拾取：PENDING 且未认领的任务（执行面重启后重排）。 */
    public List<DataServiceExport> findPendingExports() {
        return repository.findPendingExports();
    }

    /** 到期清理（执行面维护循环调用）：SUCCEEDED 且过 expires_at → EXPIRED。 */
    public int expireExports() {
        return repository.expireExports(Instant.now());
    }

    /** 孤儿清算（执行面启动调用）：RUNNING 早于 staleBefore → FAILED。 */
    public int reapStaleRunning(Instant staleBefore) {
        return repository.reapStaleRunning(staleBefore, Instant.now());
    }

    public List<Map<String, Object>> exports(String serviceId, String tenantId, int limit) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        requireDefinition(serviceId, tenantId);
        return repository.findExports(serviceId, tenantId, Math.min(Math.max(limit, 1), 100)).stream()
                .map(this::exportSummary).toList();
    }

    /** 执行面 GET 投影：含 keyHash（归属校验用，仅服务 token 可达）。 */
    public Map<String, Object> exportProjection(DataServiceExport export) {
        return exportProjection(export, repository.findCodeById(export.serviceId()).orElse(""));
    }

    public Map<String, Object> exportProjection(DataServiceExport export, String serviceCode) {
        var projection = new LinkedHashMap<String, Object>();
        projection.put("id", export.id());
        projection.put("serviceCode", serviceCode);
        projection.put("keyHash", export.keyHash());
        projection.put("status", export.status().name());
        projection.put("rowCount", export.rowCount());
        projection.put("fileBytes", export.fileBytes() == null ? 0 : export.fileBytes());
        projection.put("artifactUri", export.artifactUri() == null ? "" : export.artifactUri());
        projection.put("error", export.error() == null ? "" : export.error());
        projection.put("createdAt", export.createdAt().toString());
        projection.put("updatedAt", export.updatedAt().toString());
        projection.put("expiresAt", export.expiresAt() == null ? "" : export.expiresAt().toString());
        return projection;
    }

    private Map<String, Object> exportSummary(DataServiceExport export) {
        return Map.of(
                "id", export.id(),
                "status", export.status().name(),
                "rowCount", export.rowCount(),
                "fileBytes", export.fileBytes() == null ? 0 : export.fileBytes(),
                "error", export.error() == null ? "" : export.error(),
                "createdAt", export.createdAt().toString(),
                "expiresAt", export.expiresAt() == null ? "" : export.expiresAt().toString());
    }

    // ---- 合同通知面（P8 余项）：订阅自助管理 + 事件轮询 + 画像 ----

    /** 订阅创建（自助面）：归属 = keyHash 定位的 ACTIVE Key；secret 缺省生成并只回显一次。 */
    public SubscriptionIssued createSubscription(String keyHash, String webhookUrl, String webhookSecret) {
        var key = repository.findKeyByHash(keyHash)
                .filter(item -> item.status() == DataServiceKey.KeyStatus.ACTIVE)
                .orElseThrow(() -> new InvalidRequestException("API Key 无效或已吊销"));
        var definition = repository.findById(key.serviceId(), key.tenantId())
                .orElseThrow(() -> new InvalidRequestException("绑定服务不存在"));
        try {
            webhookPolicy.validate(webhookUrl);
        } catch (IllegalArgumentException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
        var secret = webhookSecret == null || webhookSecret.isBlank()
                ? "dataos_cw_" + randomHex(16) : webhookSecret;
        if (secret.length() < 32) {
            throw new InvalidRequestException("webhookSecret 至少 32 字符（HMAC-SHA256 签名素材）");
        }
        var subscription = contracts.saveSubscription(new DataServiceSubscription(
                UUID.randomUUID().toString(), definition.id(), definition.tenantId(), key.id(),
                keyHash, key.callerName(), webhookUrl.trim(), secret,
                DataServiceSubscription.SubscriptionStatus.ACTIVE, Instant.now(), null));
        return new SubscriptionIssued(subscription.id(), subscription.webhookUrl(),
                secret, subscription.createdAt().toString());
    }

    public List<Map<String, Object>> subscriptionsByKeyHash(String keyHash) {
        return contracts.findSubscriptionsByKeyHash(keyHash).stream()
                .map(item -> Map.<String, Object>of(
                        "id", item.id(),
                        "webhookUrl", item.webhookUrl(),
                        "status", item.status().name(),
                        "createdAt", item.createdAt().toString()))
                .toList();
    }

    /** 订阅吊销（自助面）：仅归属 Key 可吊销自己的订阅。 */
    public void revokeSubscription(String subscriptionId, String keyHash) {
        var subscription = contracts.findSubscription(subscriptionId)
                .orElseThrow(() -> new ResourceNotFoundException("订阅不存在: " + subscriptionId));
        if (!subscription.keyHash().equals(keyHash)) {
            throw new ResourceNotFoundException("订阅不存在: " + subscriptionId); // 归属不符与不存在同观
        }
        contracts.revokeSubscription(subscriptionId, Instant.now());
    }

    /** 测试投递（自助面）：产出 TEST 事件并走正常 fan-out，调用方全链路验证验签实现。 */
    public Map<String, Object> testSubscription(String subscriptionId, String keyHash) {
        var subscription = contracts.findSubscription(subscriptionId)
                .orElseThrow(() -> new ResourceNotFoundException("订阅不存在: " + subscriptionId));
        if (!subscription.keyHash().equals(keyHash)) {
            throw new ResourceNotFoundException("订阅不存在: " + subscriptionId);
        }
        var definition = repository.findById(subscription.serviceId(), subscription.tenantId())
                .orElseThrow(() -> new InvalidRequestException("绑定服务不存在"));
        var event = recordContractEvent(subscription.serviceId(), definition, "TEST",
                definition.versionSn(), definition.versionSn(), null);
        return Map.of("eventId", event.id(), "status", "PENDING");
    }

    /** 轮询通道（自助面）：本人服务最近的合同事件（含 TEST），调用方按 eventId 幂等消费。 */
    public List<Map<String, Object>> contractEventsByKeyHash(String keyHash, int limit) {
        var key = repository.findKeyByHash(keyHash).orElse(null);
        if (key == null) {
            return List.of();
        }
        return contracts.findEventsByService(key.serviceId(), Math.min(Math.max(limit, 1), 100)).stream()
                .map(item -> Map.<String, Object>of(
                        "eventId", item.id(),
                        "changeType", item.changeType(),
                        "fromVersion", item.fromVersion(),
                        "toVersion", item.toVersion(),
                        "diff", item.diffJson() == null ? "" : item.diffJson(),
                        "occurredAt", item.createdAt().toString()))
                .toList();
    }

    /** 调用方画像（自助面 /v1/me 的控制面源）。 */
    public Map<String, Object> keyProfile(String keyHash) {
        var key = repository.findKeyByHash(keyHash)
                .orElseThrow(() -> new ResourceNotFoundException("API Key 无效"));
        var definition = repository.findById(key.serviceId(), key.tenantId())
                .orElseThrow(() -> new InvalidRequestException("绑定服务不存在"));
        return Map.of(
                "callerName", key.callerName(),
                "keyPrefix", key.keyPrefix(),
                "keyStatus", key.status().name(),
                "serviceCode", definition.code(),
                "serviceName", definition.name(),
                "serviceStatus", definition.status().name(),
                "version", definition.versionSn(),
                "maxRows", definition.maxRows(),
                "timeoutSeconds", definition.timeoutSeconds(),
                "dailyQuota", key.dailyQuota());
    }

    /** 本人近期调用（自助面）。 */
    public List<Map<String, Object>> keyCalls(String keyHash, int limit) {
        var key = repository.findKeyByHash(keyHash).orElse(null);
        if (key == null) {
            return List.of();
        }
        return repository.findCallsByKeyId(key.id(), Math.min(Math.max(limit, 1), 100)).stream()
                .map(call -> Map.<String, Object>of(
                        "kind", call.kind(),
                        "rowCount", call.rowCount(),
                        "truncated", call.truncated(),
                        "elapsedMs", call.elapsedMs(),
                        "statusCode", call.statusCode(),
                        "calledAt", call.calledAt().toString()))
                .toList();
    }

    // ---- 管理面（运营可见） ----

    public List<Map<String, Object>> subscriptionsOfService(String id, String tenantId) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        requireDefinition(id, tenantId);
        return contracts.findSubscriptionsByService(id).stream()
                .map(item -> Map.<String, Object>of(
                        "id", item.id(),
                        "callerName", item.callerName(),
                        "webhookUrl", item.webhookUrl(),
                        "status", item.status().name(),
                        "createdAt", item.createdAt().toString(),
                        "revokedAt", item.revokedAt() == null ? "" : item.revokedAt().toString()))
                .toList();
    }

    public List<Map<String, Object>> contractEventsOfService(String id, String tenantId, int limit) {
        tenantId = tenantScope.resolve(tenantId, null).tenantId();
        requireDefinition(id, tenantId);
        return contracts.findEventsByService(id, Math.min(Math.max(limit, 1), 100)).stream()
                .map(item -> Map.<String, Object>of(
                        "eventId", item.id(),
                        "changeType", item.changeType(),
                        "fromVersion", item.fromVersion(),
                        "toVersion", item.toVersion(),
                        "diff", item.diffJson() == null ? "" : item.diffJson(),
                        "occurredAt", item.createdAt().toString()))
                .toList();
    }

    // ---- 合同事件助手 ----

    private DataServiceContractEvent recordContractEvent(String serviceId, DataServiceDefinition definition,
                                                         String changeType, String fromVersion,
                                                         String toVersion, String diffJson) {
        return contracts.recordEventAndFanOut(new DataServiceContractEvent(
                UUID.randomUUID().toString(), serviceId, definition.tenantId(), definition.code(),
                changeType, fromVersion, toVersion, diffJson, Instant.now()));
    }

    /** 变化字段 diff：{field: {from, to}}，仅含实际变化项；JSON 字段按结构化值比较。 */
    private Map<String, Object> contractDiff(DataServiceDefinition definition, String name, String description,
                                             String sqlTemplate, String parametersJson, String columnsJson,
                                             int maxRows, int timeoutSeconds) {
        var diff = new LinkedHashMap<String, Object>();
        putDiff(diff, "name", definition.name(), name);
        putDiff(diff, "description", definition.description(), description);
        putDiff(diff, "sqlTemplate", definition.sqlTemplate(), sqlTemplate);
        putDiff(diff, "parameters", definition.parametersJson(), parametersJson);
        putDiff(diff, "columns", definition.columnsJson(), columnsJson);
        putDiff(diff, "maxRows", definition.maxRows(), maxRows);
        putDiff(diff, "timeoutSeconds", definition.timeoutSeconds(), timeoutSeconds);
        return diff;
    }

    private void putDiff(Map<String, Object> diff, String field, Object from, Object to) {
        if (from instanceof String fromText && to instanceof String toText) {
            // JSON 字段的文本形态可能有键序差：结构化比较后再判等
            if (fromText.startsWith("[") || fromText.startsWith("{")) {
                try {
                    var fromTree = JSON.readTree(fromText);
                    var toTree = JSON.readTree(toText);
                    if (!fromTree.equals(toTree)) {
                        diff.put(field, Map.of("from", fromTree, "to", toTree));
                    }
                    return;
                } catch (Exception ignored) {
                    // fall through 按文本比较
                }
            }
            if (!fromText.equals(toText)) {
                diff.put(field, Map.of("from", fromText, "to", toText));
            }
            return;
        }
        if (!java.util.Objects.equals(from, to)) {
            diff.put(field, Map.of("from", String.valueOf(from), "to", String.valueOf(to)));
        }
    }

    private static String bumpVersion(String versionSn) {
        var matcher = java.util.regex.Pattern.compile("^(.*?)(\\d+)$").matcher(versionSn == null ? "" : versionSn);
        if (matcher.matches()) {
            return matcher.group(1) + (Long.parseLong(matcher.group(2)) + 1);
        }
        return "v2";
    }

    private DataServiceDefinition requireDefinition(String id, String tenantId) {
        return repository.findById(id, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("数据服务不存在: " + id));
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
            throw new InvalidRequestException("契约结构无法序列化");
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

    public record DataServiceDetail(DataServiceDefinition service, List<Map<String, Object>> keys, long totalCalls) {
    }

    public record IssuedKey(String keyId, String callerName, String apiKey, int dailyQuota,
                            String allowedHospitalsJson) {
    }

    public record SubscriptionIssued(String subscriptionId, String webhookUrl, String webhookSecret,
                                     String createdAt) {
    }
}
