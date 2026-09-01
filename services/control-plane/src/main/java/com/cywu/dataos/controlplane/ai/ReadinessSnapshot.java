package com.cywu.dataos.controlplane.ai;

import java.util.Map;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * readiness_json 的只读投影。camelCase 契约的唯一源是 ai-ready-service
 * 的 models.py（AssessmentReport）与 evaluation 报告（snake_case）——
 * 路径知识（overall 在根、certification 在 gate、评测指标在 evaluation
 * 段）只在这里声明一次；坏 JSON 返回 null，消费方不再各自发明缺字段语义。
 */
public record ReadinessSnapshot(double overall, String certification, Double mrr) {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 存库 readiness_json（版本行）的解析入口；空/坏 JSON 返回 null。 */
    public static ReadinessSnapshot parse(String readinessJson) {
        if (readinessJson == null || readinessJson.isBlank()) {
            return null;
        }
        try {
            return of(MAPPER.readTree(readinessJson));
        } catch (Exception exception) {
            return null;
        }
    }

    /** 引擎 /assess 响应（Map）与存库 JSON 走同一路径知识。 */
    public static ReadinessSnapshot of(Map<String, Object> payload) {
        return of((JsonNode) MAPPER.valueToTree(payload));
    }

    public static ReadinessSnapshot of(JsonNode root) {
        var evaluation = root.path("evaluation");
        return new ReadinessSnapshot(
                root.path("overall").asDouble(0.0),
                root.path("gate").path("certification").asText(""),
                evaluation.has("mrr") ? evaluation.path("mrr").asDouble() : null);
    }
}
