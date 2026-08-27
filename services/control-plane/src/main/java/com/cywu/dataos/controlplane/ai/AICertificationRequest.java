package com.cywu.dataos.controlplane.ai;

import java.time.Instant;

/**
 * 认证审批单（G11）：一次提交对应产品某版本的 readiness 快照；decision 由
 * 人工流转（PENDING → APPROVED / REJECTED）。
 */
public record AICertificationRequest(
        String id,
        String productId,
        String versionSn,
        double readinessOverall,
        String certification,
        String decision,
        String decisionNote,
        String requestedBy,
        String decidedBy,
        Instant decidedAt,
        Instant createdAt) {
}
