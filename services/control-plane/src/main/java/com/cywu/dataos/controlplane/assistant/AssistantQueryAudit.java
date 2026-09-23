package com.cywu.dataos.controlplane.assistant;

import java.time.Instant;

/**
 * 问数审计行（{@code data_os.assistant_query_audit} 表）：一次提问一行
 *（含拒答），只存结局与计数，不存结果行；反馈回写本行（可追溯）。
 */
public record AssistantQueryAudit(
        String id,
        String tenantId,
        String institutionId,
        String userId,
        String questionText,
        String questionCode,
        String serviceCode,
        String serviceVersion,
        String paramsJson,
        int rowCount,
        int elapsedMs,
        String outcome,
        String detail,
        String feedbackRating,
        String feedbackNote,
        Instant feedbackAt,
        Instant createdAt) {
}
