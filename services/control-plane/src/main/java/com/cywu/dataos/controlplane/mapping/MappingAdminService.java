package com.cywu.dataos.controlplane.mapping;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.cywu.dataos.controlplane.standard.DataStandard;
import com.cywu.dataos.controlplane.standard.DataStandardElement;
import com.cywu.dataos.controlplane.standard.StandardLifecycle;
import com.cywu.dataos.controlplane.standard.StandardRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

/**
 * 标准映射生命周期唯一属主（G23）。
 *
 * 规则：只有 DRAFT 可改；IN_REVIEW → ACTIVE 必须存在**同一内容 checksum** 的
 * PASS 聚合验证证据；激活/回退经映射集活动指针 CAS 串行化（并发激活只有一方
 * 成功）；RETIRED → ACTIVE 仅经回退端点；历史事件不删除。目标数据元始终对照
 * 目标标准的当前 PUBLISHED 版本校验（标准版本停用 → 激活被明确拒绝）。
 */
@Service
public class MappingAdminService {

    /** 覆盖率阈值：低于 fail 判 FAIL，低于 warn 判 WARN（VALUE_MAP/CODE 覆盖率）。 */
    static final double COVERAGE_FAIL_BELOW = 0.90;
    static final double COVERAGE_WARN_BELOW = 0.98;

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final java.util.regex.Pattern COLUMN_PATTERN =
            java.util.regex.Pattern.compile("^[A-Za-z_][A-Za-z0-9_]{0,127}$");
    private static final Set<String> CONCLUSIONS = Set.of("CONFIRMED", "NEEDS_REVIEW");

    private final MappingRepository repository;
    private final StandardRepository standards;
    private final TenantScope tenantScope;
    private final MappingValidationClient validationClient;

    public MappingAdminService(MappingRepository repository, StandardRepository standards,
                               TenantScope tenantScope, MappingValidationClient validationClient) {
        this.repository = repository;
        this.standards = standards;
        this.tenantScope = tenantScope;
        this.validationClient = validationClient;
    }

    // ---- 查询 ----

    public Map<String, Object> list(String tenantId, String query, int page, int size) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var row = repository.findSets(resolved, query, Math.max(page, 0),
                Math.min(Math.max(size, 1), 100));
        var items = new ArrayList<Map<String, Object>>();
        for (var set : row.sets()) {
            items.add(setProjection(resolved, set));
        }
        return Map.of("items", items, "total", row.total(), "page", page, "size", size);
    }

    public Map<String, Object> detail(String tenantId, String setId, String versionId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var set = requireSet(resolved, setId);
        var versions = repository.findVersions(resolved, setId);
        if (versions.isEmpty()) {
            throw new ConflictException("映射集缺少版本: " + setId);
        }
        var target = versions.stream()
                .filter(version -> version.id().equals(set.activeVersionId()))
                .findFirst().orElse(versions.get(0));
        if (versionId != null && !versionId.isBlank()) {
            target = versions.stream()
                    .filter(version -> version.id().equals(versionId))
                    .findFirst()
                    .orElseThrow(() -> new ResourceNotFoundException("映射版本不存在: " + versionId));
        }
        return Map.of(
                "set", setProjection(resolved, set),
                "versions", versions.stream().map(this::versionProjection).toList(),
                "version", Map.of(
                        "id", target.id(),
                        "versionNo", target.versionNo(),
                        "status", target.status().name(),
                        "checksum", target.checksum(),
                        "items", repository.findItems(resolved, target.id()).stream()
                                .map(this::itemProjection).toList(),
                        "validations", repository.findValidations(resolved, target.id(), 10).stream()
                                .map(this::validationProjection).toList()),
                "events", repository.findEvents(resolved, setId, 20).stream()
                        .map(this::eventProjection).toList());
    }

    // ---- 创建与新版本 ----

    public Map<String, Object> create(String tenantId, CreateMappingSetRequest request, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var code = request.code().trim();
        if (repository.existsByCode(resolved, code)) {
            throw new ConflictException("映射集代码已存在: " + code);
        }
        var standard = requireStandard(resolved, request.standardId());
        var items = validatedItems(resolved, request.standardId(), request.items());
        var now = Instant.now();
        var setId = MappingRepository.newId();
        var versionId = MappingRepository.newId();
        repository.insertSet(new StandardMappingSet(setId, resolved, code, request.name().trim(),
                request.sourceAsset().trim(), request.dataset().trim(), standard.id(),
                null, actor == null ? "" : actor, now, now));
        repository.insertVersion(new StandardMappingVersion(versionId, setId, resolved, 1,
                MappingLifecycle.DRAFT, checksumOf(items), actor == null ? "" : actor,
                null, null, null, now, now));
        repository.replaceItems(versionId, items);
        recordEvent(resolved, setId, versionId, "CREATED", actor,
                "创建映射集 " + code + "（源 " + request.sourceAsset().trim() + " → 标准 "
                        + standard.code() + "，映射项 " + items.size() + " 条）");
        return detail(resolved, setId, versionId);
    }

    public Map<String, Object> createVersion(String tenantId, String setId, String baseVersionId,
                                             String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        requireSet(resolved, setId);
        var versions = repository.findVersions(resolved, setId);
        if (versions.isEmpty()) {
            throw new ConflictException("映射集缺少版本: " + setId);
        }
        var base = versions.stream()
                .filter(version -> version.id().equals(baseVersionId))
                .findFirst()
                .orElse(versions.stream()
                        .filter(version -> version.status() == MappingLifecycle.ACTIVE)
                        .findFirst()
                        .orElse(versions.get(0)));
        var copied = repository.findItems(resolved, base.id()).stream()
                .map(item -> new StandardMappingItem(MappingRepository.newId(), null,
                        item.sourceColumn(), item.targetElementCode(), item.transform(),
                        item.transformParam(), item.conclusion(), item.note(),
                        item.sortOrder(), Instant.now()))
                .toList();
        var nextNo = repository.maxVersionNo(resolved, setId) + 1;
        var now = Instant.now();
        var versionId = MappingRepository.newId();
        repository.insertVersion(new StandardMappingVersion(versionId, setId, resolved, nextNo,
                MappingLifecycle.DRAFT, checksumOf(copied), actor == null ? "" : actor,
                null, null, null, now, now));
        repository.replaceItems(versionId, copied);
        recordEvent(resolved, setId, versionId, "VERSION_CREATED", actor,
                "新建映射版本 v" + nextNo + "（基准 v" + base.versionNo() + "，映射项 " + copied.size() + " 条）");
        return detail(resolved, setId, versionId);
    }

    public Map<String, Object> updateVersion(String tenantId, String versionId,
                                             UpdateMappingVersionRequest request, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (version.status() != MappingLifecycle.DRAFT) {
            throw new ConflictException("只有 DRAFT 版本可修改，当前: " + version.status());
        }
        if (!request.isEmpty()) {
            if (request.setName() != null && !request.setName().isBlank()) {
                repository.updateSetName(version.mappingSetId(), request.setName().trim());
            }
            if (request.items() != null) {
                var items = validatedItems(resolved,
                        requireSet(resolved, version.mappingSetId()).standardId(), request.items());
                repository.replaceItems(versionId, items);
                repository.updateChecksum(versionId, checksumOf(items));
            }
            recordEvent(resolved, version.mappingSetId(), versionId, "DRAFT_UPDATED", actor,
                    "草稿修改（映射项" + (request.items() == null ? "未变更）" : "整体替换并重算 checksum）"));
        }
        return detail(resolved, version.mappingSetId(), versionId);
    }

    // ---- 导入（CSV/JSON，dry-run 先行；仅 DRAFT）----

    public Map<String, Object> importItems(String tenantId, String versionId, String body,
                                           boolean dryRun, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (version.status() != MappingLifecycle.DRAFT) {
            throw new ConflictException("只有 DRAFT 版本可导入，当前: " + version.status());
        }
        var standardId = requireSet(resolved, version.mappingSetId()).standardId();
        List<CreateMappingSetRequest.ItemContract> contracts;
        if (body.trim().startsWith("{")) {
            try {
                contracts = JSON.readValue(body, ImportBody.class).items();
            } catch (com.fasterxml.jackson.core.JsonProcessingException failure) {
                throw new InvalidRequestException("JSON 导入体解析失败: " + failure.getOriginalMessage());
            }
        } else {
            contracts = parseCsv(body);
        }
        var report = new LinkedHashMap<String, Object>();
        var problems = new ArrayList<String>();
        List<StandardMappingItem> items = List.of();
        try {
            items = validatedItems(resolved, standardId, contracts);
        } catch (InvalidRequestException rejection) {
            problems.add(rejection.getMessage());
        }
        report.put("dryRun", dryRun);
        report.put("itemCount", contracts == null ? 0 : contracts.size());
        report.put("problems", problems);
        report.put("checksum", problems.isEmpty() ? checksumOf(items) : "");
        if (dryRun || !problems.isEmpty()) {
            return report;
        }
        repository.replaceItems(versionId, items);
        repository.updateChecksum(versionId, checksumOf(items));
        recordEvent(resolved, version.mappingSetId(), versionId, "IMPORTED", actor,
                "导入映射项 " + items.size() + " 条（checksum " + checksumOf(items).substring(0, 12) + "…）");
        report.put("applied", true);
        return report;
    }

    private List<CreateMappingSetRequest.ItemContract> parseCsv(String csv) {
        var rows = com.cywu.dataos.controlplane.standard.StandardController.parseCsvRows(csv);
        if (rows.isEmpty()) {
            throw new InvalidRequestException("CSV 内容为空");
        }
        var header = rows.get(0).stream().map(String::trim).map(String::toLowerCase).toList();
        var required = List.of("source_column", "target_element_code", "transform");
        var missing = required.stream().filter(column -> !header.contains(column)).toList();
        if (!missing.isEmpty()) {
            throw new InvalidRequestException("CSV 缺少必需列: " + missing);
        }
        var index = new LinkedHashMap<String, Integer>();
        for (int i = 0; i < header.size(); i++) {
            index.put(header.get(i), i);
        }
        var contracts = new ArrayList<CreateMappingSetRequest.ItemContract>();
        for (int r = 1; r < rows.size(); r++) {
            var row = rows.get(r);
            if (row.stream().allMatch(value -> value == null || value.trim().isBlank())) {
                continue;
            }
            var cell = new java.util.function.Function<String, String>() {
                @Override
                public String apply(String name) {
                    var at = index.get(name);
                    return at == null || at >= row.size() ? "" : row.get(at).trim();
                }
            };
            if (cell.apply("source_column").isBlank()) {
                throw new InvalidRequestException("CSV 第 " + (r + 1) + " 行 source_column 为空");
            }
            contracts.add(new CreateMappingSetRequest.ItemContract(
                    cell.apply("source_column"), cell.apply("target_element_code"),
                    cell.apply("transform"), cell.apply("transform_param"),
                    cell.apply("conclusion"), cell.apply("note")));
        }
        if (contracts.isEmpty()) {
            throw new InvalidRequestException("CSV 无数据行");
        }
        return contracts;
    }

    /** 与标准域同构的导入体（items 与创建接口一致）。 */
    public record ImportBody(List<CreateMappingSetRequest.ItemContract> items) {
    }

    // ---- 生命周期 ----

    public Map<String, Object> submit(String tenantId, String versionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (!version.status().canTransitionTo(MappingLifecycle.IN_REVIEW)) {
            throw new ConflictException("状态机拒绝: " + version.status() + " → IN_REVIEW");
        }
        validatedItems(resolved, requireSet(resolved, version.mappingSetId()).standardId(),
                toContracts(repository.findItems(resolved, versionId)));
        if (repository.markSubmitted(versionId) != 1) {
            throw new ConflictException("提交失败：版本状态已变化: " + versionId);
        }
        recordEvent(resolved, version.mappingSetId(), versionId, "SUBMITTED", actor,
                "提交评审（v" + version.versionNo() + "）");
        return detail(resolved, version.mappingSetId(), versionId);
    }

    /** 聚合验证：编排质量执行器，落验证证据（带 checksum），返回判定与明细。 */
    public Map<String, Object> validate(String tenantId, String versionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        var set = requireSet(resolved, version.mappingSetId());
        var items = repository.findItems(resolved, versionId);
        if (items.isEmpty()) {
            throw new InvalidRequestException("映射项为空，无法验证");
        }
        var elements = publishedElements(resolved, set.standardId());
        var payload = new ArrayList<Map<String, Object>>();
        for (var item : items) {
            var element = elements.get(item.targetElementCode());
            var entry = new LinkedHashMap<String, Object>();
            entry.put("sourceColumn", item.sourceColumn());
            entry.put("targetType", element == null ? "UNKNOWN" : element.dataType());
            entry.put("transform", item.transform().name());
            entry.put("transformParam", item.transformParam());
            if (element != null && "CODE".equals(element.dataType())) {
                entry.put("allowedValues", element.values().stream()
                        .map(value -> value.code()).toList());
            }
            payload.add(entry);
        }
        JsonNode response = validationClient.validate(set.dataset(), payload);
        var verdict = verdictOf(response);
        repository.insertValidation(new StandardMappingValidation(
                MappingRepository.newId(), versionId, resolved, version.checksum(),
                verdict.get("status").toString(), verdict.get("resultJson").toString(),
                textOf(response, "asOf"), actor == null ? "" : actor, Instant.now()));
        recordEvent(resolved, version.mappingSetId(), versionId, "VALIDATED", actor,
                "聚合验证 " + verdict.get("status") + "（checksum " + version.checksum().substring(0, 12) + "…）");
        return detail(resolved, version.mappingSetId(), versionId);
    }

    /** 判定：类型不兼容→FAIL；覆盖率<0.90→FAIL；<0.98→WARN；否则 PASS。 */
    private Map<String, Object> verdictOf(JsonNode response) {
        var incompatible = 0;
        var worstCoverage = 1.0;
        for (var item : response.path("items")) {
            if (!item.path("compatible").asBoolean(true)) {
                incompatible++;
            }
            if (item.has("coverage") && !item.path("coverage").isNull()) {
                worstCoverage = Math.min(worstCoverage, item.path("coverage").asDouble(1.0));
            }
        }
        String status;
        if (incompatible > 0 || worstCoverage < COVERAGE_FAIL_BELOW) {
            status = "FAIL";
        } else if (worstCoverage < COVERAGE_WARN_BELOW) {
            status = "WARN";
        } else {
            status = "PASS";
        }
        return Map.of("status", status, "resultJson", response.toString());
    }

    public Map<String, Object> activate(String tenantId, String versionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (!version.status().canTransitionTo(MappingLifecycle.ACTIVE)) {
            throw new ConflictException("状态机拒绝: " + version.status()
                    + " → ACTIVE（须先经 IN_REVIEW）");
        }
        // 门控一：同 checksum 的 PASS 验证证据
        var hasPassEvidence = repository.findValidations(resolved, versionId, 50).stream()
                .anyMatch(validation -> "PASS".equals(validation.status())
                        && version.checksum().equals(validation.checksum()));
        if (!hasPassEvidence) {
            throw new ConflictException("缺少同一内容 checksum 的 PASS 验证证据，不能生效（先执行聚合验证）");
        }
        // 门控二：目标标准仍有 PUBLISHED 版本且目标数据元在册（标准停用→明确拒绝）
        var set = requireSet(resolved, version.mappingSetId());
        validatedItems(resolved, set.standardId(),
                toContracts(repository.findItems(resolved, versionId)));
        // 门控三：活动指针 CAS——并发激活只有一方成功
        if (repository.casActivePointer(set.id(), set.activeVersionId(), versionId) != 1) {
            throw new ConflictException("并发激活：活动版本已被其他操作变更，请刷新后重试");
        }
        if (repository.markActive(versionId) != 1) {
            throw new ConflictException("激活失败：版本状态已变化: " + versionId);
        }
        for (var other : repository.findVersions(resolved, set.id())) {
            if (other.status() == MappingLifecycle.ACTIVE && !other.id().equals(versionId)) {
                repository.markRetired(other.id());
                recordEvent(resolved, set.id(), other.id(), "RETIRED", actor,
                        "v" + other.versionNo() + " 被 v" + version.versionNo() + " 取代");
            }
        }
        recordEvent(resolved, set.id(), versionId, "ACTIVATED", actor,
                "生效 v" + version.versionNo() + "（checksum " + version.checksum().substring(0, 12) + "…）");
        return detail(resolved, set.id(), versionId);
    }

    public Map<String, Object> retire(String tenantId, String versionId, String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        if (!version.status().canTransitionTo(MappingLifecycle.RETIRED)) {
            throw new ConflictException("状态机拒绝: " + version.status() + " → RETIRED");
        }
        if (repository.markRetired(versionId) != 1) {
            throw new ConflictException("停用失败：版本状态已变化: " + versionId);
        }
        repository.clearActivePointerIfPointing(version.mappingSetId(), versionId);
        recordEvent(resolved, version.mappingSetId(), versionId, "RETIRED", actor,
                "人工停用 v" + version.versionNo());
        return detail(resolved, version.mappingSetId(), versionId);
    }

    /** 回退：目标须为同集 RETIRED（曾生效）版本；当前活动版停用、目标复活；历史事件不删。 */
    public Map<String, Object> rollback(String tenantId, String setId, String targetVersionId,
                                        String actor) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var set = requireSet(resolved, setId);
        var target = requireVersion(resolved, targetVersionId);
        if (!target.mappingSetId().equals(set.id())) {
            throw new InvalidRequestException("回退目标不属于该映射集");
        }
        if (target.status() != MappingLifecycle.RETIRED) {
            throw new ConflictException("回退目标必须是 RETIRED 版本，当前: " + target.status());
        }
        // 门控：PASS 证据仍须与目标内容 checksum 对齐（防止回退到内容已漂移的旧证据）
        var hasPassEvidence = repository.findValidations(resolved, target.id(), 50).stream()
                .anyMatch(validation -> "PASS".equals(validation.status())
                        && target.checksum().equals(validation.checksum()));
        if (!hasPassEvidence) {
            throw new ConflictException("回退目标缺少同 checksum 的 PASS 验证证据，不能生效");
        }
        if (repository.casActivePointer(set.id(), set.activeVersionId(), target.id()) != 1) {
            throw new ConflictException("并发回退：活动版本已被其他操作变更，请刷新后重试");
        }
        if (set.activeVersionId() != null) {
            var current = repository.findVersion(resolved, set.activeVersionId());
            current.ifPresent(active -> {
                repository.markRetired(active.id());
                recordEvent(resolved, set.id(), active.id(), "RETIRED", actor,
                        "v" + active.versionNo() + " 因回退被停用");
            });
        }
        if (repository.markActive(target.id()) != 1) {
            throw new ConflictException("回退失败：目标版本状态已变化: " + target.id());
        }
        recordEvent(resolved, set.id(), target.id(), "ROLLED_BACK", actor,
                "回退到 v" + target.versionNo());
        return detail(resolved, set.id(), target.id());
    }

    // ---- 影响范围 / 覆盖率 ----

    public Map<String, Object> impact(String tenantId, String versionId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var version = requireVersion(resolved, versionId);
        var set = requireSet(resolved, version.mappingSetId());
        var standard = requireStandard(resolved, set.standardId());
        var items = repository.findItems(resolved, versionId);
        var elements = publishedElements(resolved, set.standardId());
        var mapped = new TreeMap<String, Integer>();
        for (var item : items) {
            mapped.merge(item.targetElementCode(), 1, Integer::sum);
        }
        var uncovered = elements.keySet().stream()
                .filter(code -> !mapped.containsKey(code))
                .toList();
        var latestValidation = repository.findValidations(resolved, versionId, 1).stream()
                .findFirst().map(this::validationProjection).orElse(Map.of());
        return Map.of(
                "versionId", version.id(),
                "versionNo", version.versionNo(),
                "status", version.status().name(),
                "sourceAsset", set.sourceAsset(),
                "dataset", set.dataset(),
                "standard", Map.of("id", standard.id(), "code", standard.code(), "name", standard.name()),
                "itemCount", items.size(),
                "mappedElements", mapped,
                "unpublishedUncoveredElements", uncovered,
                "latestValidation", latestValidation);
    }

    /** 映射覆盖率投影（ai-ready fhir_mapping_coverage 与门户消费）：ACTIVE 映射对已发布标准 CODE 数据元的覆盖。 */
    public Map<String, Object> coverage(String tenantId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var required = new HashSet<>(repository.publishedCodeElements(resolved));
        var covered = new HashSet<>(repository.activeMappedElements(resolved));
        covered.retainAll(required);
        Double coverage = required.isEmpty() ? null : (double) covered.size() / required.size();
        var projection = new LinkedHashMap<String, Object>();
        projection.put("asOf", Instant.now().toString());
        projection.put("activeMappingVersions", repository.countActiveSets(resolved));
        projection.put("publishedCodeElements", required.size());
        projection.put("coveredCodeElements", covered.size());
        projection.put("coverage", coverage);
        return projection;
    }

    // ---- 校验 ----

    private List<StandardMappingItem> validatedItems(String tenantId, String standardId,
                                                     List<CreateMappingSetRequest.ItemContract> contracts) {
        if (contracts == null || contracts.isEmpty()) {
            throw new InvalidRequestException("映射项列表不能为空");
        }
        var elements = publishedElements(tenantId, standardId);
        if (elements.isEmpty()) {
            throw new ConflictException("目标标准没有已发布版本（或版本已停用），不能定义映射");
        }
        var items = new ArrayList<StandardMappingItem>();
        var seen = new HashSet<String>();
        for (int i = 0; i < contracts.size(); i++) {
            var contract = contracts.get(i);
            var where = "映射项[" + i + " " + contract.sourceColumn() + "]";
            if (contract.sourceColumn() == null || !COLUMN_PATTERN.matcher(contract.sourceColumn()).matches()) {
                throw new InvalidRequestException(where + " source_column 非法（须为安全标识符）");
            }
            if (!seen.add(contract.sourceColumn())) {
                throw new InvalidRequestException("源字段重复: " + contract.sourceColumn());
            }
            var element = elements.get(contract.targetElementCode());
            if (element == null) {
                throw new InvalidRequestException(where + " 目标数据元不在标准已发布版本中: "
                        + contract.targetElementCode());
            }
            MappingTransform transform;
            try {
                transform = MappingTransform.valueOf(contract.transform() == null ? ""
                        : contract.transform().trim().toUpperCase());
            } catch (IllegalArgumentException bad) {
                throw new InvalidRequestException(where + " 非法转换: " + contract.transform()
                        + "（只允许 COPY/TRIM/UPPER/DATE_FORMAT/VALUE_MAP）");
            }
            String param;
            try {
                param = transform.validateParam(contract.transformParam(), element.dataType());
            } catch (IllegalArgumentException bad) {
                throw new InvalidRequestException(where + " " + bad.getMessage());
            }
            if (transform == MappingTransform.VALUE_MAP) {
                validateValueMap(where, param, element);
            }
            var conclusion = contract.conclusion() == null || contract.conclusion().isBlank()
                    ? "CONFIRMED" : contract.conclusion().trim().toUpperCase();
            if (!CONCLUSIONS.contains(conclusion)) {
                throw new InvalidRequestException(where + " 非法人工结论: " + contract.conclusion()
                        + "（CONFIRMED/NEEDS_REVIEW）");
            }
            items.add(new StandardMappingItem(MappingRepository.newId(), null,
                    contract.sourceColumn(), contract.targetElementCode(), transform, param,
                    conclusion, contract.note() == null ? "" : contract.note().trim(),
                    i, Instant.now()));
        }
        return items;
    }

    private void validateValueMap(String where, String param, DataStandardElement element) {
        Map<String, String> map;
        try {
            map = JSON.readValue(param, new com.fasterxml.jackson.core.type.TypeReference<>() {
            });
        } catch (com.fasterxml.jackson.core.JsonProcessingException failure) {
            throw new InvalidRequestException(where + " VALUE_MAP 参数必须是 {源值: 标准值} JSON");
        }
        if (map == null || map.isEmpty()) {
            throw new InvalidRequestException(where + " VALUE_MAP 参数不能为空");
        }
        var allowed = new HashSet<>(element.values().stream().map(value -> value.code()).toList());
        for (var entry : map.entrySet()) {
            if (entry.getKey() == null || entry.getKey().isBlank()) {
                throw new InvalidRequestException(where + " VALUE_MAP 源值为空");
            }
            if (!allowed.contains(entry.getValue())) {
                throw new InvalidRequestException(where + " VALUE_MAP 目标值不在标准值域中: "
                        + entry.getValue());
            }
        }
    }

    private Map<String, DataStandardElement> publishedElements(String tenantId, String standardId) {
        return standards.findVersionsByStatus(tenantId, standardId, StandardLifecycle.PUBLISHED)
                .stream().findFirst()
                .map(version -> standards.findElements(tenantId, version.id()))
                .orElse(List.of())
                .stream()
                .collect(java.util.stream.Collectors.toMap(
                        DataStandardElement::code, element -> element, (a, b) -> a,
                        java.util.LinkedHashMap::new));
    }

    /** 内容 checksum：对排序后的映射项做稳定序列化的 SHA-256。 */
    static String checksumOf(List<StandardMappingItem> items) {
        var normalized = items.stream()
                .map(item -> item.sourceColumn() + "|" + item.targetElementCode() + "|"
                        + item.transform().name() + "|" + item.transformParam() + "|"
                        + item.conclusion())
                .sorted()
                .toList();
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            for (var line : normalized) {
                digest.update(line.getBytes(StandardCharsets.UTF_8));
                digest.update((byte) '\n');
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static List<CreateMappingSetRequest.ItemContract> toContracts(List<StandardMappingItem> items) {
        return items.stream()
                .map(item -> new CreateMappingSetRequest.ItemContract(
                        item.sourceColumn(), item.targetElementCode(), item.transform().name(),
                        item.transformParam(), item.conclusion(), item.note()))
                .toList();
    }

    private static String textOf(JsonNode node, String field) {
        var value = node.path(field).asText("");
        return value == null ? "" : value;
    }

    // ---- 投影 ----

    private Map<String, Object> setProjection(String tenantId, StandardMappingSet set) {
        var versions = repository.findVersions(tenantId, set.id());
        var active = versions.stream()
                .filter(version -> version.id().equals(set.activeVersionId()))
                .findFirst().orElse(null);
        var standard = standards.findStandard(tenantId, set.standardId()).orElse(null);
        var projection = new LinkedHashMap<String, Object>();
        projection.put("id", set.id());
        projection.put("code", set.code());
        projection.put("name", set.name());
        projection.put("sourceAsset", set.sourceAsset());
        projection.put("dataset", set.dataset());
        projection.put("standard", standard == null ? Map.of()
                : Map.of("id", standard.id(), "code", standard.code(), "name", standard.name()));
        projection.put("versionCount", versions.size());
        projection.put("activeVersion", active == null ? Map.of()
                : Map.of("versionNo", active.versionNo(), "status", active.status().name(),
                        "checksum", active.checksum()));
        projection.put("updatedAt", set.updatedAt().toString());
        return projection;
    }

    private Map<String, Object> versionProjection(StandardMappingVersion version) {
        var projection = new LinkedHashMap<String, Object>();
        projection.put("id", version.id());
        projection.put("versionNo", version.versionNo());
        projection.put("status", version.status().name());
        projection.put("checksum", version.checksum());
        if (version.submittedAt() != null) {
            projection.put("submittedAt", version.submittedAt().toString());
        }
        if (version.activatedAt() != null) {
            projection.put("activatedAt", version.activatedAt().toString());
        }
        if (version.retiredAt() != null) {
            projection.put("retiredAt", version.retiredAt().toString());
        }
        projection.put("createdAt", version.createdAt().toString());
        return projection;
    }

    private Map<String, Object> itemProjection(StandardMappingItem item) {
        return Map.of(
                "id", item.id(),
                "sourceColumn", item.sourceColumn(),
                "targetElementCode", item.targetElementCode(),
                "transform", item.transform().name(),
                "transformParam", item.transformParam(),
                "conclusion", item.conclusion(),
                "note", item.note());
    }

    private Map<String, Object> validationProjection(StandardMappingValidation validation) {
        var projection = new LinkedHashMap<String, Object>();
        projection.put("id", validation.id());
        projection.put("status", validation.status());
        projection.put("checksum", validation.checksum());
        projection.put("dataTime", validation.dataTime());
        projection.put("createdAt", validation.createdAt().toString());
        projection.put("result", validation.resultJson());
        return projection;
    }

    private Map<String, Object> eventProjection(StandardMappingEvent event) {
        return Map.of("id", event.id(), "eventType", event.eventType(), "actor", event.actor(),
                "detail", event.detail(), "createdAt", event.createdAt().toString());
    }

    private StandardMappingSet requireSet(String tenantId, String setId) {
        return repository.findSet(tenantId, setId)
                .orElseThrow(() -> new ResourceNotFoundException("映射集不存在: " + setId));
    }

    private StandardMappingVersion requireVersion(String tenantId, String versionId) {
        return repository.findVersion(tenantId, versionId)
                .orElseThrow(() -> new ResourceNotFoundException("映射版本不存在: " + versionId));
    }

    private DataStandard requireStandard(String tenantId, String standardId) {
        return standards.findStandard(tenantId, standardId)
                .orElseThrow(() -> new ResourceNotFoundException("数据标准不存在: " + standardId));
    }

    private void recordEvent(String tenantId, String setId, String versionId,
                             String type, String actor, String detail) {
        repository.insertEvent(new StandardMappingEvent(MappingRepository.newId(), setId,
                versionId == null ? "" : versionId, tenantId, type, actor == null ? "" : actor,
                detail == null ? "" : detail.substring(0, Math.min(detail.length(), 1000)),
                Instant.now()));
    }
}
