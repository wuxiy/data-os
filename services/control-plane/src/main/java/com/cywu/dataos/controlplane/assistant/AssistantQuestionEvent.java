package com.cywu.dataos.controlplane.assistant;

import java.time.Instant;

/**
 * 问题生命周期事件（{@code data_os.assistant_question_event} 表，G27）：
 * CREATED / UPDATED / PUBLISHED / DEPRECATED / DELETED。问题行只保留当前
 * 状态，管理动作逐条留痕；删除问题时事件保留（按 code 可追溯）。
 */
public record AssistantQuestionEvent(
        String id,
        String tenantId,
        String questionId,
        String questionCode,
        String action,
        String actor,
        String detailJson,
        Instant createdAt) {
}
