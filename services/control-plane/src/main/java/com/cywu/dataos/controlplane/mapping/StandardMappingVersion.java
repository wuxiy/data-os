package com.cywu.dataos.controlplane.mapping;

import java.time.Instant;

/** 映射版本（不可变）：checksum 是激活门控的比对基准（须有同 checksum 的 PASS 验证）。 */
public record StandardMappingVersion(
        String id,
        String mappingSetId,
        String tenantId,
        int versionNo,
        MappingLifecycle status,
        String checksum,
        String createdBy,
        Instant submittedAt,
        Instant activatedAt,
        Instant retiredAt,
        Instant createdAt,
        Instant updatedAt) {
}
