package com.cywu.dataos.controlplane.mapping;

import java.time.Instant;

/** 映射域审计事件（不可变）：创建/草稿/导入/验证/评审/生效/回退/停用。 */
public record StandardMappingEvent(
        String id,
        String mappingSetId,
        String versionId,
        String tenantId,
        String eventType,
        String actor,
        String detail,
        Instant createdAt) {
}
