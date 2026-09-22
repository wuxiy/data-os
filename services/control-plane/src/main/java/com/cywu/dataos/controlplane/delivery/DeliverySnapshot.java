package com.cywu.dataos.controlplane.delivery;

import java.time.Instant;

/**
 * 不可变验收快照（{@code data_os.delivery_snapshot} 表）。checksum 是
 * manifest_json 字节流的 SHA-256；evidence.zip 内含同字节 manifest 与校验值。
 */
public record DeliverySnapshot(
        String id,
        String projectId,
        String tenantId,
        String checksum,
        String manifestJson,
        String idempotencyKey,
        String createdBy,
        Instant createdAt) {
}
