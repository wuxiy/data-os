package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;

/**
 * 数据服务 API Key（{@code data_os.data_service_key} 表）。明文只在发放
 * 响应中出现一次，库内只存 SHA-256 hex 与展示用前缀；授权医院集合为
 * JSON 数组（"*" 表示不限）。
 */
public record DataServiceKey(
        String id,
        String serviceId,
        String tenantId,
        String callerName,
        String keyHash,
        String keyPrefix,
        String allowedHospitalsJson,
        int dailyQuota,
        KeyStatus status,
        Instant createdAt,
        Instant lastUsedAt,
        Instant revokedAt) {

    public enum KeyStatus {
        ACTIVE,
        REVOKED
    }
}
