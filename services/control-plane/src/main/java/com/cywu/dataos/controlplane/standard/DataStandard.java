package com.cywu.dataos.controlplane.standard;

import java.time.Instant;

/** 数据标准集合（租户内 code 唯一）；生命周期挂在版本上，本表只承载归属与描述。 */
public record DataStandard(
        String id,
        String tenantId,
        String code,
        String name,
        String description,
        String owner,
        String createdBy,
        Instant createdAt,
        Instant updatedAt) {
}
