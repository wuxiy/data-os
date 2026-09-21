package com.cywu.dataos.controlplane.standard;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

/**
 * 数据标准中心（G22）：标准/版本/元素/值域/事件的生命周期唯一属主。
 *
 * 规则：只有 DRAFT 可改；PUBLISHED 不可覆盖只能新建版本；发布会自动停用同标准
 * 的旧发布版；类型白名单与 CODE 值域非空校验在所有写入路径统一收口；发布后向
 * OM 做术语投影，失败置 SYNC_PENDING 人工重试，绝不伪造成功。
 */
@Service
public class StandardAdminService {

    /** 数据元类型白名单（FHIR 导出与映射验证共用口径）。 */
    public static final Set<String> DATA_TYPES = Set.of(
            "STRING", "INTEGER", "DECIMAL", "DATE", "DATETIME", "BOOLEAN", "CODE");

    public static final Set<String> SENSITIVITIES = Set.of("NORMAL", "SENSITIVE", "CRITICAL");

    private final StandardRepository repository;
    private final TenantScope tenantScope;
    private final ObjectProvider<OpenMetadataTermSyncClient> termSync;

    public StandardAdminService(StandardRepository repository, TenantScope tenantScope,
                                ObjectProvider<OpenMetadataTermSyncClient> termSync) {
        this.repository = repository;
        this.tenantScope = tenantScope;
        this.termSync = termSync;
    }

    // ---- 查询 ----

    public Map<String, Object> list(String tenantId, String query, String status,
                                    int page, int size) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var row = repository.findStandards(resolved, query,
                Math.max(page, 0), Math.min(Math.max(size, 1), 100));
        var items = new ArrayList<Map<String, Object>>();
        for (var standard : row.standards()) {
            items.add(listProjection(resolved, standard, status));
        }
        if (status != null && !status.isBlank()) {
            items.removeIf(item -> !status.equals(((Map<?, ?>) item.get("latestVersion")).get("status")));
        }
        return Map.of("items", items, "total", row.total(),
                "page", page, "size", size);
    }

    public Map<String, Object> detail(String tenantId, String standardId, String versionId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var standard = requireStandard(resolved, standardId);
        var versions = repository.findVersions(resolved, standardId);
        if (versions.isEmpty()) {
            throw new ConflictException("标准缺少版本: " + standardId);
        }
        var target = versions.get(0);
        if (versionId != null && !versionId.isBlank()) {
            target = versions.stream()
                    .filter(version -> version.id().equals(versionId))
                    .findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException("标准版本不存在: " + versionId));
        }
        var elements = repository.findElements(resolved, target.id());
        return Map.of(
                "standard", standardProjection(standard),
                "versions", versions.stream().map(this::versionProjection).toList(),
                "version", Map.of(
                        "id", target.id(),
                        "versionNo", target.versionNo(),
                        "status", target.status().name(),
                        "syncStatus", target.syncStatus(),
                        "elements", elements.stream().map(this::elementProjection).toList()),
                "events", repository.findEvents(resolved, standardId, 20).stream()
                        .map(this::eventProjection).toList());
    }

    // ---- 创建与新版本 ----

    public Map<String, Object> create(String tenantId, CreateStandardRequest request, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var code = request.code().trim();
        if (repository.existsByCode(resolved, code)) {
            throw new ConflictException("标准代码已存在: " + code);
        }
        var elements = validatedElements(request.elements());
        var now = Instant.now();
        var standardId = StandardRepository.newId();
        repository.insertStandard(new DataStandard(standardId, resolved, code, request.name().trim(),
                orEmpty(request.description()), orEmpty(request.owner()), orEmpty(actor), now, now));
        var versionId = StandardRepository.newId();
        repository.insertVersion(new DataStandardVersion(versionId, standardId, resolved, 1,
                StandardLifecycle.DRAFT, orEmpty(actor), null, null, null,
                "SYNC_PENDING", null, now, now));
        repository.replaceElements(versionId, elements);
        recordEvent(resolved, standardId, versionId, "CREATED", actor,
                "创建标准 " + code + "（草稿 v1，元素 " + elements.size() + " 个）");
        return detail(resolved, standardId, versionId);
    }

    public Map<String, Object> createVersion(String tenantId, String standardId,
                                             String baseVersionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var standard = requireStandard(resolved, standardId);
        var versions = repository.findVersions(resolved, standardId);
        if (versions.isEmpty()) {
            throw new ConflictException("标准缺少版本: " + standardId);
        }
        DataStandardVersion base;
        if (baseVersionId != null && !baseVersionId.isBlank()) {
            base = versions.stream()
                    .filter(version -> version.id().equals(baseVersionId))
                    .findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException("基准版本不存在: " + baseVersionId));
        } else {
            base = versions.stream()
                    .filter(version -> version.status() == StandardLifecycle.PUBLISHED)
                    .findFirst()
                    .orElse(versions.get(0));
        }
        var nextNo = repository.maxVersionNo(resolved, standardId) + 1;
        var now = Instant.now();
        var versionId = StandardRepository.newId();
        repository.insertVersion(new DataStandardVersion(versionId, standardId, resolved, nextNo,
                StandardLifecycle.DRAFT, orEmpty(actor), null, null, null,
                "SYNC_PENDING", null, now, now));
        // 复制基准元素：主键全部重新生成（内容复制，非行复制）
        var copied = repository.findElements(resolved, base.id()).stream()
                .map(element -> new DataStandardElement(StandardRepository.newId(), versionId,
                        element.code(), element.name(), element.dataType(), element.required(),
                        element.definition(), element.sensitivity(), element.assetRef(),
                        element.sortOrder(), Instant.now(),
                        element.values().stream()
                                .map(value -> new DataStandardValue(StandardRepository.newId(), null,
                                        value.code(), value.displayName(), value.validFrom(),
                                        value.validTo(), value.sortOrder(), Instant.now()))
                                .toList()))
                .toList();
        repository.replaceElements(versionId, copied);
        recordEvent(resolved, standardId, versionId, "VERSION_CREATED", actor,
                "新建版本 v" + nextNo + "（基准 v" + base.versionNo() + "）");
        return detail(resolved, standardId, versionId);
    }

    public Map<String, Object> updateVersion(String tenantId, String versionId,
                                             UpdateStandardVersionRequest request, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (version.status() != StandardLifecycle.DRAFT) {
            throw new ConflictException("只有 DRAFT 版本可修改，当前: " + version.status());
        }
        if (!request.isEmpty()) {
            if (request.standardName() != null || request.description() != null
                    || request.owner() != null) {
                repository.updateStandardMeta(version.standardId(), request.standardName(),
                        request.description(), request.owner());
            }
            if (request.elements() != null) {
                repository.replaceElements(versionId, validatedElements(request.elements()));
            }
            recordEvent(resolved, version.standardId(), versionId, "DRAFT_UPDATED", actor,
                    "草稿修改（元素" + (request.elements() == null ? "未变更）" : "整体替换）"));
        }
        return detail(resolved, version.standardId(), versionId);
    }

    // ---- 生命周期 ----

    public Map<String, Object> submit(String tenantId, String versionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (!version.status().canTransitionTo(StandardLifecycle.IN_REVIEW)) {
            throw new ConflictException("状态机拒绝: " + version.status() + " → IN_REVIEW");
        }
        // 提交前完整校验（含 CODE 值域非空）
        validatePersistedElements(repository.findElements(resolved, versionId));
        if (repository.markSubmitted(versionId) != 1) {
            throw new ConflictException("提交失败：版本状态已变化: " + versionId);
        }
        recordEvent(resolved, version.standardId(), versionId, "SUBMITTED", actor,
                "提交评审（v" + version.versionNo() + "）");
        return detail(resolved, version.standardId(), versionId);
    }

    public Map<String, Object> publish(String tenantId, String versionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (!version.status().canTransitionTo(StandardLifecycle.PUBLISHED)) {
            throw new ConflictException("状态机拒绝: " + version.status()
                    + " → PUBLISHED（须先经 IN_REVIEW）");
        }
        if (repository.markPublished(versionId) != 1) {
            throw new ConflictException("发布失败：版本状态已变化: " + versionId);
        }
        recordEvent(resolved, version.standardId(), versionId, "PUBLISHED", actor,
                "发布 v" + version.versionNo());
        // 新发布版取代旧发布版（历史不删除，事件留痕）
        for (var other : repository.findVersionsByStatus(resolved, version.standardId(),
                StandardLifecycle.PUBLISHED)) {
            if (!other.id().equals(versionId)) {
                repository.markDeprecated(other.id());
                recordEvent(resolved, version.standardId(), other.id(), "DEPRECATED", actor,
                        "v" + other.versionNo() + " 被 v" + version.versionNo() + " 取代");
            }
        }
        attemptSync(resolved, version.standardId(), versionId, version.versionNo(), actor);
        return detail(resolved, version.standardId(), versionId);
    }

    public Map<String, Object> deprecate(String tenantId, String versionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (!version.status().canTransitionTo(StandardLifecycle.DEPRECATED)) {
            throw new ConflictException("状态机拒绝: " + version.status() + " → DEPRECATED");
        }
        if (repository.markDeprecated(versionId) != 1) {
            throw new ConflictException("停用失败：版本状态已变化: " + versionId);
        }
        recordEvent(resolved, version.standardId(), versionId, "DEPRECATED", actor,
                "人工停用 v" + version.versionNo());
        return detail(resolved, version.standardId(), versionId);
    }

    /** SYNC_PENDING 的人工重试闭环（发布后的 OM 投影，不影响治理事实）。 */
    public Map<String, Object> retrySync(String tenantId, String versionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (version.status() != StandardLifecycle.PUBLISHED) {
            throw new ConflictException("只有 PUBLISHED 版本可重试同步，当前: " + version.status());
        }
        attemptSync(resolved, version.standardId(), versionId, version.versionNo(), actor);
        return detail(resolved, version.standardId(), versionId);
    }

    // ---- 导入（CSV 模板 / 内部 JSON，先 dry-run）----

    public Map<String, Object> importStandards(String tenantId, CreateStandardRequest request,
                                               Integer versionNo, boolean dryRun, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var report = new LinkedHashMap<String, Object>();
        var problems = new ArrayList<String>();
        var code = request.code() == null ? "" : request.code().trim();
        if (code.isBlank()) {
            problems.add("standard_code 为空");
        } else if (repository.existsByCode(resolved, code)) {
            problems.add("标准代码已存在: " + code);
        }
        List<DataStandardElement> elements = List.of();
        try {
            elements = validatedElements(request.elements());
        } catch (InvalidRequestException rejection) {
            problems.add(rejection.getMessage());
        }
        // 版本号单调：导入只创建首个版本，携带 versionNo < 1 视为倒退/非法
        if (versionNo != null && versionNo < 1) {
            problems.add("版本倒退：携带 versionNo=" + versionNo + "，必须 ≥ 1");
        }
        report.put("dryRun", dryRun);
        report.put("standardCode", code);
        report.put("elementCount", request.elements() == null ? 0 : request.elements().size());
        report.put("valueCount", elements.stream().mapToLong(element -> element.values().size()).sum());
        report.put("problems", problems);
        if (dryRun || !problems.isEmpty()) {
            return report;
        }
        var created = create(resolved, request, actor);
        // create 恒建 v1；导入携带更高 versionNo 时补建空版本序列直至目标（保持单调）
        // —— 简化口径：导入只建首个版本，携带 versionNo 仅参与倒退校验。
        report.put("created", created);
        return report;
    }

    // ---- 对比 / 影响 / FHIR ----

    public Map<String, Object> compare(String tenantId, String versionId, String otherVersionId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var left = requireVersion(resolved, versionId);
        var right = requireVersion(resolved, otherVersionId);
        if (!left.standardId().equals(right.standardId())) {
            throw new InvalidRequestException("只能对比同一标准下的两个版本");
        }
        var leftElements = repository.findElements(resolved, versionId);
        var rightElements = repository.findElements(resolved, otherVersionId);
        var leftByCode = byCode(leftElements);
        var rightByCode = byCode(rightElements);
        var added = new ArrayList<Map<String, Object>>();
        var removed = new ArrayList<Map<String, Object>>();
        var changed = new ArrayList<Map<String, Object>>();
        for (var entry : leftByCode.entrySet()) {
            var element = entry.getValue();
            var counterpart = rightByCode.get(entry.getKey());
            if (counterpart == null) {
                removed.add(elementSummary(element));
                continue;
            }
            var differences = new ArrayList<String>();
            if (!element.dataType().equals(counterpart.dataType())) {
                differences.add("类型 " + counterpart.dataType() + " → " + element.dataType());
            }
            if (element.required() != counterpart.required()) {
                differences.add("必填 " + counterpart.required() + " → " + element.required());
            }
            if (!element.definition().equals(counterpart.definition())) {
                differences.add("定义变更");
            }
            if (!element.sensitivity().equals(counterpart.sensitivity())) {
                differences.add("敏感级别 " + counterpart.sensitivity() + " → " + element.sensitivity());
            }
            var addedValues = element.values().stream().map(DataStandardValue::code)
                    .filter(value -> counterpart.values().stream()
                            .noneMatch(other -> other.code().equals(value)))
                    .toList();
            var removedValues = counterpart.values().stream().map(DataStandardValue::code)
                    .filter(value -> element.values().stream()
                            .noneMatch(other -> other.code().equals(value)))
                    .toList();
            if (!addedValues.isEmpty() || !removedValues.isEmpty()) {
                differences.add("值域 +" + addedValues.size() + "/-" + removedValues.size());
            }
            if (!differences.isEmpty()) {
                changed.add(Map.of("code", element.code(), "name", element.name(),
                        "differences", differences));
            }
        }
        for (var entry : rightByCode.entrySet()) {
            if (!leftByCode.containsKey(entry.getKey())) {
                added.add(elementSummary(entry.getValue()));
            }
        }
        return Map.of(
                "left", Map.of("versionId", left.id(), "versionNo", left.versionNo()),
                "right", Map.of("versionId", right.id(), "versionNo", right.versionNo()),
                "added", added, "removed", removed, "changed", changed);
    }

    /** 影响范围：元素上的资产引用聚合（映射覆盖率接入留给 G23，当前如实为空）。 */
    public Map<String, Object> impact(String tenantId, String versionId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        var elements = repository.findElements(resolved, versionId);
        var assets = elements.stream()
                .map(DataStandardElement::assetRef)
                .filter(ref -> ref != null && !ref.isBlank())
                .sorted()
                .distinct()
                .toList();
        return Map.of(
                "versionId", version.id(),
                "versionNo", version.versionNo(),
                "status", version.status().name(),
                "elementCount", elements.size(),
                "referencedAssets", assets,
                "notes", List.of("标准映射覆盖接入后（G23）本报告将补映射资产面"));
    }

    /** FHIR R4 导出：CODE 元素 → CodeSystem + ValueSet；不含任何内部数据库标识。 */
    public Map<String, Object> fhirBundle(String tenantId, String versionId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        var standard = requireStandard(resolved, version.standardId());
        var elements = repository.findElements(resolved, versionId);
        var entries = new ArrayList<Map<String, Object>>();
        for (var element : elements) {
            if (!"CODE".equals(element.dataType()) || element.values().isEmpty()) {
                continue;
            }
            var systemUrl = "urn:dataos:standard:" + standard.code() + ":" + element.code();
            entries.add(Map.of(
                    "fullUrl", systemUrl,
                    "resource", Map.of(
                            "resourceType", "CodeSystem",
                            "id", standard.code() + "-" + element.code(),
                            "url", systemUrl,
                            "version", "v" + version.versionNo(),
                            "name", element.code(),
                            "title", element.name(),
                            "status", fhirStatus(version.status()),
                            "content", "complete",
                            "concept", element.values().stream()
                                    .map(value -> Map.of(
                                            "code", value.code(),
                                            "display", value.displayName()))
                                    .toList())));
            entries.add(Map.of(
                    "fullUrl", systemUrl + ":vs",
                    "resource", Map.of(
                            "resourceType", "ValueSet",
                            "id", standard.code() + "-" + element.code() + "-vs",
                            "url", systemUrl + ":vs",
                            "version", "v" + version.versionNo(),
                            "name", element.code() + "-valueset",
                            "title", element.name() + " 值域",
                            "status", fhirStatus(version.status()),
                            "compose", Map.of("include", List.of(Map.of(
                                    "system", systemUrl,
                                    "concept", element.values().stream()
                                            .map(value -> Map.of(
                                                    "code", value.code(),
                                                    "display", value.displayName()))
                                            .toList()))))));
        }
        return Map.of(
                "resourceType", "Bundle",
                "id", standard.code() + "-v" + version.versionNo(),
                "type", "collection",
                "timestamp", Instant.now().toString(),
                "entry", entries);
    }

    // ---- 校验 ----

    private List<DataStandardElement> validatedElements(List<CreateStandardRequest.ElementContract> contracts) {
        if (contracts == null || contracts.isEmpty()) {
            throw new InvalidRequestException("数据元列表不能为空");
        }
        var elements = new ArrayList<DataStandardElement>();
        var seenCodes = new LinkedHashSet<String>();
        for (int i = 0; i < contracts.size(); i++) {
            var contract = contracts.get(i);
            var where = "元素[" + i + " " + contract.code() + "]";
            if (contract.code() == null || contract.code().isBlank()) {
                throw new InvalidRequestException(where + " code 为空");
            }
            if (!seenCodes.add(contract.code())) {
                throw new InvalidRequestException("数据元 code 重复: " + contract.code());
            }
            if (contract.name() == null || contract.name().isBlank()) {
                throw new InvalidRequestException(where + " name 为空");
            }
            var dataType = contract.dataType() == null ? "" : contract.dataType().trim().toUpperCase();
            if (!DATA_TYPES.contains(dataType)) {
                throw new InvalidRequestException(where + " 非法类型: " + contract.dataType()
                        + "（允许 " + String.join("/", DATA_TYPES.stream().sorted().toList()) + "）");
            }
            var sensitivity = contract.sensitivity() == null || contract.sensitivity().isBlank()
                    ? "NORMAL" : contract.sensitivity().trim().toUpperCase();
            if (!SENSITIVITIES.contains(sensitivity)) {
                throw new InvalidRequestException(where + " 非法敏感级别: " + contract.sensitivity());
            }
            var values = new ArrayList<DataStandardValue>();
            if ("CODE".equals(dataType)) {
                if (contract.values() == null || contract.values().isEmpty()) {
                    throw new InvalidRequestException(where + " CODE 类型值域为空");
                }
                var seenValues = new LinkedHashSet<String>();
                for (var value : contract.values()) {
                    if (value.code() == null || value.code().isBlank()) {
                        throw new InvalidRequestException(where + " 值域 code 为空");
                    }
                    if (!seenValues.add(value.code())) {
                        throw new InvalidRequestException(where + " 值域 code 重复: " + value.code());
                    }
                    if (value.displayName() == null || value.displayName().isBlank()) {
                        throw new InvalidRequestException(where + " 值域 " + value.code() + " 显示名为空");
                    }
                    values.add(new DataStandardValue(StandardRepository.newId(), null,
                            value.code(), value.displayName(), orEmpty(value.validFrom()),
                            orEmpty(value.validTo()), values.size(), Instant.now()));
                }
            } else if (contract.values() != null && !contract.values().isEmpty()) {
                throw new InvalidRequestException(where + " 非 CODE 类型不携带值域");
            }
            elements.add(new DataStandardElement(StandardRepository.newId(), null,
                    contract.code(), contract.name(), dataType,
                    contract.required(), orEmpty(contract.definition()), sensitivity,
                    orEmpty(contract.assetRef()), i, Instant.now(), values));
        }
        return elements;
    }

    /** 持久化形态的完整性校验（提交前）：CODE 值域非空、类型仍在白名单。 */
    private void validatePersistedElements(List<DataStandardElement> elements) {
        for (var element : elements) {
            if (!DATA_TYPES.contains(element.dataType())) {
                throw new InvalidRequestException("数据元 " + element.code() + " 类型非法: "
                        + element.dataType());
            }
            if ("CODE".equals(element.dataType()) && element.values().isEmpty()) {
                throw new InvalidRequestException("数据元 " + element.code() + " CODE 类型值域为空");
            }
        }
    }

    private void attemptSync(String tenantId, String standardId, String versionId,
                             int versionNo, String actor) {
        var client = termSync.getIfAvailable();
        if (client == null) {
            repository.setSyncStatus(versionId, "SYNC_PENDING");
            recordEvent(tenantId, standardId, versionId, "SYNC_PENDING", actor,
                    "OM 未配置，术语投影挂起（配置 data-os.openmetadata.base-url 后重试）");
            return;
        }
        try {
            var standard = requireStandard(tenantId, standardId);
            client.pushTerms(standard.code(), versionNo,
                    repository.findElements(tenantId, versionId));
            repository.setSyncStatus(versionId, "SYNCED");
            recordEvent(tenantId, standardId, versionId, "SYNC_SUCCEEDED", actor,
                    "OM 术语投影完成（v" + versionNo + "）");
        } catch (RuntimeException failure) {
            repository.setSyncStatus(versionId, "SYNC_PENDING");
            recordEvent(tenantId, standardId, versionId, "SYNC_PENDING", actor,
                    "OM 术语投影失败: " + truncate(failure.getMessage(), 400));
        }
    }

    // ---- 投影 ----

    private Map<String, Object> listProjection(String tenantId, DataStandard standard, String status) {
        var versions = repository.findVersions(tenantId, standard.id());
        var latest = versions.isEmpty() ? null : versions.get(0);
        var projection = new LinkedHashMap<String, Object>();
        projection.put("id", standard.id());
        projection.put("code", standard.code());
        projection.put("name", standard.name());
        projection.put("description", standard.description());
        projection.put("owner", standard.owner());
        projection.put("updatedAt", standard.updatedAt().toString());
        projection.put("versionCount", versions.size());
        projection.put("latestVersion", latest == null ? Map.of()
                : Map.of("versionNo", latest.versionNo(), "status", latest.status().name(),
                        "syncStatus", latest.syncStatus()));
        return projection;
    }

    private Map<String, Object> standardProjection(DataStandard standard) {
        return Map.of("id", standard.id(), "code", standard.code(), "name", standard.name(),
                "description", standard.description(), "owner", standard.owner(),
                "createdBy", standard.createdBy(), "createdAt", standard.createdAt().toString(),
                "updatedAt", standard.updatedAt().toString());
    }

    private Map<String, Object> versionProjection(DataStandardVersion version) {
        var projection = new LinkedHashMap<String, Object>();
        projection.put("id", version.id());
        projection.put("versionNo", version.versionNo());
        projection.put("status", version.status().name());
        projection.put("syncStatus", version.syncStatus());
        projection.put("createdBy", version.createdBy());
        projection.put("createdAt", version.createdAt().toString());
        if (version.submittedAt() != null) {
            projection.put("submittedAt", version.submittedAt().toString());
        }
        if (version.publishedAt() != null) {
            projection.put("publishedAt", version.publishedAt().toString());
        }
        if (version.deprecatedAt() != null) {
            projection.put("deprecatedAt", version.deprecatedAt().toString());
        }
        return projection;
    }

    private Map<String, Object> elementProjection(DataStandardElement element) {
        return Map.of(
                "id", element.id(),
                "code", element.code(),
                "name", element.name(),
                "dataType", element.dataType(),
                "required", element.required(),
                "definition", element.definition(),
                "sensitivity", element.sensitivity(),
                "assetRef", element.assetRef(),
                "values", element.values().stream().map(value -> Map.of(
                        "code", value.code(), "displayName", value.displayName(),
                        "validFrom", value.validFrom(), "validTo", value.validTo())).toList());
    }

    private Map<String, Object> eventProjection(DataStandardEvent event) {
        return Map.of("id", event.id(), "eventType", event.eventType(), "actor", event.actor(),
                "detail", event.detail(), "createdAt", event.createdAt().toString());
    }

    private Map<String, Object> elementSummary(DataStandardElement element) {
        return Map.of("code", element.code(), "name", element.name(),
                "dataType", element.dataType(), "valueCount", element.values().size());
    }

    private static Map<String, DataStandardElement> byCode(List<DataStandardElement> elements) {
        var byCode = new LinkedHashMap<String, DataStandardElement>();
        elements.forEach(element -> byCode.put(element.code(), element));
        return byCode;
    }

    private static String fhirStatus(StandardLifecycle status) {
        return switch (status) {
            case PUBLISHED -> "active";
            case DEPRECATED -> "retired";
            default -> "draft";
        };
    }

    private DataStandard requireStandard(String tenantId, String standardId) {
        return repository.findStandard(tenantId, standardId)
                .orElseThrow(() -> new ResourceNotFoundException("数据标准不存在: " + standardId));
    }

    private DataStandardVersion requireVersion(String tenantId, String versionId) {
        return repository.findVersion(tenantId, versionId)
                .orElseThrow(() -> new ResourceNotFoundException("标准版本不存在: " + versionId));
    }

    private void recordEvent(String tenantId, String standardId, String versionId,
                             String type, String actor, String detail) {
        repository.insertEvent(new DataStandardEvent(StandardRepository.newId(), standardId,
                versionId == null ? "" : versionId, tenantId, type, orEmpty(actor),
                truncate(detail, 1000), Instant.now()));
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return "";
        }
        return value.length() <= max ? value : value.substring(0, max);
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value.trim();
    }
}
