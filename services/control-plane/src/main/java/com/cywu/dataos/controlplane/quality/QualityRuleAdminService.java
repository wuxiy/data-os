package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 动态质量规则管理（G2G 批次 2）：台账 CRUD + 推送 runner 编译。
 *
 * <p>推送发生在事务内：runner 拒绝（400）→ 本地回滚，两侧不产生半份状态；
 * 连接类失败（503）同样回滚。极端场景下（推送成功后本地提交前崩溃）runner
 * 可能残留孤儿规则——下次同 rule_id 保存会收敛，不做补偿协议。
 */
@Service
public class QualityRuleAdminService {

    /** 16 类全集（与 runner rulegen 同步；语义校验在 runner）。 */
    private static final Set<String> SUPPORTED_TYPES = Set.of(
            "NOT_NULL", "UNIQUE", "VAL_SET", "VAL_MINMAX", "VAL_LEN", "STR_REGEX", "FK_REF", "SQL",
            "CROSS_VAL_COMPARE", "STAT_VAL_COMPARE", "SQL_STAT_VAL", "DETAIL_STAT",
            "FIELD_LOGIC", "UPDATE_TIME", "TIME_CONTINUITY");

    /** 计算形状类型：失败列由 runner 编译器派生，门户不提交证据白名单。 */
    public static final Set<String> COMPUTED_EVIDENCE_TYPES = Set.of(
            "STAT_VAL_COMPARE", "SQL_STAT_VAL", "DETAIL_STAT", "TIME_CONTINUITY");

    private static final Set<String> EVIDENCE_CLASSIFICATIONS = Set.of(
            "IDENTIFIER", "CATEGORY", "SAFE", "REDACTED");

    private final QualityRuleDefinitionRepository repository;
    private final DynamicRulePushClient pushClient;
    private final TenantScope tenantScope;
    private final com.cywu.dataos.controlplane.standard.StandardRepository standards;

    public QualityRuleAdminService(QualityRuleDefinitionRepository repository,
                                   DynamicRulePushClient pushClient, TenantScope tenantScope,
                                   com.cywu.dataos.controlplane.standard.StandardRepository standards) {
        this.repository = repository;
        this.pushClient = pushClient;
        this.tenantScope = tenantScope;
        this.standards = standards;
    }

    public List<QualityRuleDefinition> list() {
        var scope = tenantScope.current();
        return repository.findAll(scope.tenantId(), scope.institutionId());
    }

    @Transactional
    public QualityRuleDefinition save(String ruleId, SaveQualityRuleDefinitionRequest request) {
        var scope = tenantScope.current();
        var normalizedId = normalizeRuleId(ruleId);
        var ruleType = request.ruleType().trim().toUpperCase(Locale.ROOT);
        if (!SUPPORTED_TYPES.contains(ruleType)) {
            throw new InvalidRequestException("不支持的规则类型：" + request.ruleType());
        }
        var params = new java.util.LinkedHashMap<>(request.params());
        if ("VAL_SET".equals(ruleType)) {
            resolveStandardValues(params, scope.tenantId());
        }
        var evidenceColumns = request.evidenceColumns();
        for (var column : evidenceColumns) {
            var classification = column.getOrDefault("classification", "REDACTED").toUpperCase(Locale.ROOT);
            if (!EVIDENCE_CLASSIFICATIONS.contains(classification)) {
                throw new InvalidRequestException("非法证据列脱敏分类：" + classification);
            }
        }
        var existing = repository.findById(normalizedId, scope.tenantId(), scope.institutionId()).orElse(null);
        var definition = new QualityRuleDefinition(
                normalizedId, scope.tenantId(), scope.institutionId(),
                ruleType, request.datasetId().trim(),
                request.targetColumn() == null ? "" : request.targetColumn().trim(),
                java.util.Collections.unmodifiableMap(params), evidenceColumns,
                existing == null || existing.enabled(),
                existing == null ? Instant.now() : existing.createdAt(),
                Instant.now());
        pushClient.push(definition);
        repository.save(definition);
        return definition;
    }

    /**
     * VAL_SET 字典引用（nema ValSetRule 的 Dict 分支）：standardElementId 在保存时
     * 解析为标准中心值域代码快照（values）。标准值域后续变更不自动跟随——需重新
     * 保存规则刷新快照（解析属主在控制面，runner 保持无标准中心依赖）。
     */
    private void resolveStandardValues(java.util.Map<String, Object> params, String tenantId) {
        var reference = String.valueOf(params.getOrDefault("standardElementId", "")).trim();
        if (reference.isBlank()) return;
        var codes = standards.findElementCodes(tenantId, reference);
        if (codes.isEmpty()) {
            throw new InvalidRequestException("标准值域引用未找到可用代码（数据元不存在或无值域）：" + reference);
        }
        params.put("values", codes);
    }

    @Transactional
    public QualityRuleDefinition setEnabled(String ruleId, boolean enabled) {
        var scope = tenantScope.current();
        var definition = require(ruleId, scope);
        if (enabled) {
            pushClient.push(definition);
        } else {
            pushClient.disable(definition.ruleId());
        }
        repository.setEnabled(definition.ruleId(), scope.tenantId(), scope.institutionId(), enabled);
        return require(ruleId, scope);
    }

    @Transactional
    public void delete(String ruleId) {
        var scope = tenantScope.current();
        var definition = require(ruleId, scope);
        pushClient.disable(definition.ruleId());
        repository.delete(definition.ruleId(), scope.tenantId(), scope.institutionId());
    }

    private QualityRuleDefinition require(String ruleId, TenantScope.Scope scope) {
        return repository.findById(normalizeRuleId(ruleId), scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到动态质量规则：" + ruleId));
    }

    private String normalizeRuleId(String ruleId) {
        var value = ruleId == null ? "" : ruleId.trim().toLowerCase(Locale.ROOT);
        if (!value.matches("[a-z0-9][a-z0-9_.\\-]{2,199}")) {
            throw new InvalidRequestException("规则编号只能使用小写字母数字与 ._-：" + ruleId);
        }
        return value;
    }
}
