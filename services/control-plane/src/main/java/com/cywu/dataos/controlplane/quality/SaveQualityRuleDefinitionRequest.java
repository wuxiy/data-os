package com.cywu.dataos.controlplane.quality;

import java.util.List;
import java.util.Map;

import jakarta.validation.constraints.NotBlank;

/**
 * 动态规则保存请求。语义校验（标识符、参数完整性、SQL 只读）在 runner 编译时
 * 强制执行；控制面先做形状校验（类型枚举 + 必填项），把 runner 的 400 如实
 * 转回门户。
 */
public record SaveQualityRuleDefinitionRequest(
        @NotBlank(message = "ruleType 不能为空") String ruleType,
        @NotBlank(message = "datasetId 不能为空") String datasetId,
        String targetColumn,
        Map<String, Object> params,
        List<Map<String, String>> evidenceColumns) {

    public SaveQualityRuleDefinitionRequest {
        params = params == null ? Map.of() : Map.copyOf(params);
        evidenceColumns = evidenceColumns == null ? List.of() : List.copyOf(evidenceColumns);
    }
}
