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

    /** 首刀支持的八类单表谓词（与 runner rulegen 同步；语义校验在 runner）。 */
    private static final Set<String> SUPPORTED_TYPES = Set.of(
            "NOT_NULL", "UNIQUE", "VAL_SET", "VAL_MINMAX", "VAL_LEN", "STR_REGEX", "FK_REF", "SQL");

    private static final Set<String> EVIDENCE_CLASSIFICATIONS = Set.of(
            "IDENTIFIER", "CATEGORY", "SAFE", "REDACTED");

    private final QualityRuleDefinitionRepository repository;
    private final DynamicRulePushClient pushClient;
    private final TenantScope tenantScope;

    public QualityRuleAdminService(QualityRuleDefinitionRepository repository,
                                   DynamicRulePushClient pushClient, TenantScope tenantScope) {
        this.repository = repository;
        this.pushClient = pushClient;
        this.tenantScope = tenantScope;
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
            throw new InvalidRequestException("不支持的规则类型（首刀八类）：" + request.ruleType());
        }
        for (var column : request.evidenceColumns()) {
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
                request.params(), request.evidenceColumns(),
                existing == null || existing.enabled(),
                existing == null ? Instant.now() : existing.createdAt(),
                Instant.now());
        pushClient.push(definition);
        repository.save(definition);
        return definition;
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
