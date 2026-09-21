package com.cywu.dataos.controlplane.standard;

import java.time.Instant;
import java.util.List;

/** 数据元（版本内 code 唯一）；CODE 型须有非空值域。 */
public record DataStandardElement(
        String id,
        String versionId,
        String code,
        String name,
        String dataType,
        boolean required,
        String definition,
        String sensitivity,
        String assetRef,
        int sortOrder,
        Instant createdAt,
        List<DataStandardValue> values) {
}
