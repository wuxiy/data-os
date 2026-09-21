package com.cywu.dataos.controlplane.standard;

import java.time.Instant;

/** 标准域审计事件（不可变）：创建、草稿修改、提交、发布、停用、导入与 OM 投影状态。 */
public record DataStandardEvent(
        String id,
        String standardId,
        String versionId,
        String tenantId,
        String eventType,
        String actor,
        String detail,
        Instant createdAt) {
}
