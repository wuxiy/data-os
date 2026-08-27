package com.cywu.dataos.controlplane.ai;

import java.time.Instant;

/**
 * 评测反馈（G12 数据飞轮 / Learning Plane）：锚定一条评测明细（问题 × 指标 ×
 * 结论）。处置只改状态——新版本与语料变更均由人工触发，候选不自动上线。
 */
public record AIEvaluationFeedback(
        String id,
        String productId,
        String versionSn,
        String question,
        String metric,
        String outcome,
        String feedbackType,
        String detail,
        String status,
        String resolution,
        String createdBy,
        String resolvedBy,
        Instant resolvedAt,
        Instant createdAt) {

    public static final String STATUS_CREATED = "CREATED";
    public static final String STATUS_CONSUMED = "CONSUMED";
    public static final String STATUS_DISMISSED = "DISMISSED";
}
