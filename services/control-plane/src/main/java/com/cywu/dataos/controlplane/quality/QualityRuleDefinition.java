package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** 动态质量规则定义（G2G 批次 2）：控制面台账行；执行语义由 runner 编译持有。 */
public record QualityRuleDefinition(
        String ruleId,
        String tenantId,
        String institutionId,
        String ruleType,
        String datasetId,
        String targetColumn,
        Map<String, Object> params,
        List<Map<String, String>> evidenceColumns,
        boolean enabled,
        Instant createdAt,
        Instant updatedAt) {
}
