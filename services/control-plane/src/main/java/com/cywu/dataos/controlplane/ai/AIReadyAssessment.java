package com.cywu.dataos.controlplane.ai;

import java.util.Map;

/**
 * 引擎评估结论投影（engine /assess 响应的裁剪面）——rawJson 保留完整报告，
 * 摘要字段供版本回写与门户展示。
 */
public record AIReadyAssessment(
        String product,
        String version,
        String profile,
        double overall,
        String certification,
        String assessedAt,
        Map<String, Object> rawJson) {

    public static AIReadyAssessment from(Map<String, Object> payload) {
        var snapshot = ReadinessSnapshot.of(payload);
        return new AIReadyAssessment(
                String.valueOf(payload.getOrDefault("product", "")),
                String.valueOf(payload.getOrDefault("version", "")),
                String.valueOf(payload.getOrDefault("profile", "")),
                snapshot.overall(),
                snapshot.certification(),
                String.valueOf(payload.getOrDefault("assessedAt", "")),
                payload);
    }
}
