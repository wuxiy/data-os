package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;

/**
 * 合同事件投递（发件箱行）：每（事件 × 订阅）一条，idempotency_key
 * 幂等。状态机 PENDING → SENDING → DELIVERED / FAILED（退避重试）→
 * SKIPPED（超限留痕）；与治理通知发件箱同款租约语义。
 */
public record DataServiceDelivery(
        String id,
        String eventId,
        String subscriptionId,
        String tenantId,
        DeliveryStatus status,
        int attemptCount,
        String lastError,
        Instant nextAttemptAt,
        Instant lockedUntil,
        String lockedBy,
        Instant deliveredAt,
        String idempotencyKey,
        Instant createdAt,
        Instant updatedAt) {

    public enum DeliveryStatus {
        PENDING, SENDING, DELIVERED, FAILED, SKIPPED
    }
}
