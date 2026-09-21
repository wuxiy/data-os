package com.cywu.dataos.controlplane.mapping;

import java.time.Instant;

/** 聚合验证证据（不可变）：checksum 对齐验证时刻的版本内容；只存聚合结果。 */
public record StandardMappingValidation(
        String id,
        String versionId,
        String tenantId,
        String checksum,
        String status,
        String resultJson,
        String dataTime,
        String createdBy,
        Instant createdAt) {
}
