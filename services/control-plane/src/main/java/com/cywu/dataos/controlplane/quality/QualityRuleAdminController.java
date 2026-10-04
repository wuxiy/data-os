package com.cywu.dataos.controlplane.quality;

import java.util.List;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 动态质量规则管理面（G2G 批次 2）：台账 CRUD + 启停，保存即推送 runner 编译。 */
@RestController
@RequestMapping("/api/v1/quality/rules")
public class QualityRuleAdminController {

    private final QualityRuleAdminService service;

    public QualityRuleAdminController(QualityRuleAdminService service) {
        this.service = service;
    }

    /** 类型目录（表单渲染用；语义校验在 runner）。 */
    @GetMapping("/types")
    public List<RuleTypeView> types() {
        return List.of(
                new RuleTypeView("NOT_NULL", "非空校验", "完整性", false),
                new RuleTypeView("UNIQUE", "唯一性校验", "完整性", false),
                new RuleTypeView("FK_REF", "外键参照校验", "完整性", false),
                new RuleTypeView("VAL_SET", "值域校验", "规范性", false),
                new RuleTypeView("VAL_MINMAX", "数值范围校验", "规范性", false),
                new RuleTypeView("VAL_LEN", "长度范围校验", "规范性", false),
                new RuleTypeView("STR_REGEX", "正则校验", "规范性", false),
                new RuleTypeView("SQL", "自定义 SQL 校验", "准确性", false),
                new RuleTypeView("CROSS_VAL_COMPARE", "跨表数据值比较", "一致性", false),
                new RuleTypeView("STAT_VAL_COMPARE", "统计数据值比较", "一致性", true),
                new RuleTypeView("SQL_STAT_VAL", "SQL 统计值比较", "一致性", true),
                new RuleTypeView("DETAIL_STAT", "明细汇总校验", "一致性", true),
                new RuleTypeView("FIELD_LOGIC", "字段间关系", "准确性", false),
                new RuleTypeView("UPDATE_TIME", "更新时效校验", "及时性", false),
                new RuleTypeView("TIME_CONTINUITY", "时间连续性校验", "稳定性", true));
    }

    @GetMapping
    public RuleListResponse list() {
        var items = service.list();
        return new RuleListResponse(items, items.size());
    }

    @PutMapping("/{ruleId}")
    public ResponseEntity<QualityRuleDefinition> save(@PathVariable String ruleId,
                                                      @Valid @RequestBody SaveQualityRuleDefinitionRequest request) {
        var definition = service.save(ruleId, request);
        return ResponseEntity.ok(definition);
    }

    @PostMapping("/{ruleId}/enable")
    public QualityRuleDefinition enable(@PathVariable String ruleId) {
        return service.setEnabled(ruleId, true);
    }

    @PostMapping("/{ruleId}/disable")
    public QualityRuleDefinition disable(@PathVariable String ruleId) {
        return service.setEnabled(ruleId, false);
    }

    @DeleteMapping("/{ruleId}")
    public ResponseEntity<Void> delete(@PathVariable String ruleId) {
        service.delete(ruleId);
        return ResponseEntity.noContent().build();
    }

    /** computedEvidence = 失败列由编译器派生（门户不提交白名单）。 */
    public record RuleTypeView(String type, String label, String dimension, boolean computedEvidence) {
    }

    public record RuleListResponse(List<QualityRuleDefinition> items, int total) {
    }
}
