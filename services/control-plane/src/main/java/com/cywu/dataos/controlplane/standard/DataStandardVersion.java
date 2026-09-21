package com.cywu.dataos.controlplane.standard;

import java.time.Instant;

/**
 * 数据标准版本（不可变）：status 走 {@link StandardLifecycle}；
 * syncStatus 是发布后向 OpenMetadata 的术语投影状态（SYNCED / SYNC_PENDING），
 * 投影失败不影响治理事实，人工重试闭环。
 */
public record DataStandardVersion(
        String id,
        String standardId,
        String tenantId,
        int versionNo,
        StandardLifecycle status,
        String createdBy,
        Instant submittedAt,
        Instant publishedAt,
        Instant deprecatedAt,
        String syncStatus,
        Instant syncedAt,
        Instant createdAt,
        Instant updatedAt) {
}
