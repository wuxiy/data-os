package com.cywu.dataos.controlplane.mapping;

import java.time.Instant;

/** 映射集：源资产 + 目标标准 + 活动版本指针（可回退，历史不删除）。 */
public record StandardMappingSet(
        String id,
        String tenantId,
        String code,
        String name,
        String sourceAsset,
        String dataset,
        String standardId,
        String activeVersionId,
        String createdBy,
        Instant createdAt,
        Instant updatedAt) {
}
