package com.cywu.dataos.controlplane.mapping;

import java.time.Instant;

/** 映射项：源字段 → 目标数据元 + 受控转换 + 人工结论。 */
public record StandardMappingItem(
        String id,
        String versionId,
        String sourceColumn,
        String targetElementCode,
        MappingTransform transform,
        String transformParam,
        String conclusion,
        String note,
        int sortOrder,
        Instant createdAt) {
}
