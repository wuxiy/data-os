package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;

/**
 * 一次异步导出任务（P7）：PENDING → RUNNING → SUCCEEDED/FAILED；
 * SUCCEEDED 到期由清理转为 EXPIRED。RUNNING 的认领是 CAS
 * （WHERE status='PENDING'），重放安全。
 */
public record DataServiceExport(
        String id,
        String serviceId,
        String tenantId,
        String keyHash,
        ExportStatus status,
        String parametersJson,
        long rowCount,
        Long fileBytes,
        String artifactUri,
        String error,
        Instant createdAt,
        Instant updatedAt,
        Instant expiresAt) {

    public enum ExportStatus {
        PENDING, RUNNING, SUCCEEDED, FAILED, EXPIRED;

        public boolean canTransitionTo(ExportStatus target) {
            return switch (this) {
                case PENDING -> target == RUNNING || target == FAILED;
                case RUNNING -> target == SUCCEEDED || target == FAILED;
                case SUCCEEDED -> target == EXPIRED;
                default -> false;
            };
        }
    }
}
