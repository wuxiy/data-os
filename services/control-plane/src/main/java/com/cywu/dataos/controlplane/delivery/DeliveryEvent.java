package com.cywu.dataos.controlplane.delivery;

import java.time.Instant;

/**
 * 交付事件（{@code data_os.delivery_event} 表）：状态动作事件携带幂等键
 * （租户内唯一，重放判定依据）；创建/加项/被阻断尝试的键为 NULL。
 */
public record DeliveryEvent(
        String id,
        String projectId,
        String tenantId,
        String eventType,
        String actor,
        String idempotencyKey,
        String detail,
        Instant createdAt) {
}
