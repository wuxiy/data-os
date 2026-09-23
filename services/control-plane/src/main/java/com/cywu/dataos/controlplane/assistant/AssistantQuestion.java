package com.cywu.dataos.controlplane.assistant;

import java.time.Instant;
import java.util.List;

/**
 * 已验证问题（{@code data_os.assistant_verified_question} 表）：问题代码、
 * 别名、参数 Schema、已发布 Data Service 引用与回答模板。状态
 * DRAFT→PUBLISHED→DEPRECATED；仅 PUBLISHED 参与匹配与查询。
 */
public record AssistantQuestion(
        String id,
        String tenantId,
        String code,
        String question,
        List<String> aliases,
        String paramSchemaJson,
        String serviceCode,
        String answerTemplate,
        String status,
        String createdBy,
        Instant createdAt,
        Instant updatedAt) {
}
