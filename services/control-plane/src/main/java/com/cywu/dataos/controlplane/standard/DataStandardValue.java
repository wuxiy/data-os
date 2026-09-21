package com.cywu.dataos.controlplane.standard;

import java.time.Instant;

/** 值域代码（数据元内 code 唯一）；valid_from/valid_to 为日期字符串口径的有效期。 */
public record DataStandardValue(
        String id,
        String elementId,
        String code,
        String displayName,
        String validFrom,
        String validTo,
        int sortOrder,
        Instant createdAt) {
}
