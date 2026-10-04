package com.cywu.dataos.controlplane.executor;

import java.util.HashMap;
import java.util.Map;

/**
 * job config 中 DolphinScheduler 工作流绑定的解析（G2G 批次 5 抽取）：运行提交
 * 适配器与调度域共用同一语义——绑定位于 config 顶层 {@code dolphinscheduler}
 * （历史别名 {@code orchestrator}），至少含 projectCode/workflowDefinitionCode。
 */
public final class DolphinBinding {

    private DolphinBinding() {
    }

    /** 定位绑定 map；config 空或形态不对时抛配置错误（与既有适配器消息一致）。 */
    public static Map<String, Object> locate(Map<String, Object> requestConfig) {
        if (requestConfig == null || requestConfig.isEmpty()) {
            throw new AdapterConfigurationException("未提供 DolphinScheduler 工作流绑定配置");
        }
        Object configured = requestConfig.get("dolphinscheduler");
        if (!(configured instanceof Map<?, ?>)) {
            configured = requestConfig.get("orchestrator");
        }
        if (!(configured instanceof Map<?, ?> map)) {
            throw new AdapterConfigurationException("缺少 dolphinscheduler 工作流绑定配置");
        }
        var binding = new HashMap<String, Object>();
        map.forEach((key, value) -> binding.put(String.valueOf(key), value));
        return binding;
    }

    /** 解析出正整数项目/工作流编号；非法时抛配置错误（与既有适配器消息一致）。 */
    public static Codes requireCodes(Map<String, Object> binding) {
        return new Codes(requiredLong(binding, "projectCode", "项目编号"),
                requiredLong(binding, "workflowDefinitionCode", "工作流定义编号"));
    }

    public static long requiredLong(Map<String, Object> binding, String key, String label) {
        var value = binding.get(key);
        if (value == null || String.valueOf(value).isBlank()) {
            throw new AdapterConfigurationException("DolphinScheduler 缺少" + label);
        }
        try {
            var result = Long.parseLong(String.valueOf(value));
            if (result <= 0) throw new NumberFormatException();
            return result;
        } catch (NumberFormatException exception) {
            throw new AdapterConfigurationException("DolphinScheduler " + label + "必须是正整数");
        }
    }

    public record Codes(long projectCode, long workflowDefinitionCode) {
    }
}
