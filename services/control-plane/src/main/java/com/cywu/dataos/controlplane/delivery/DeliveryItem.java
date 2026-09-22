package com.cywu.dataos.controlplane.delivery;

import java.time.Instant;

/**
 * 交付项（{@code data_os.delivery_item} 表）：对四类受管对象的引用。
 */
public record DeliveryItem(
        String id,
        String projectId,
        String tenantId,
        DeliveryRefType refType,
        String refId,
        String note,
        String createdBy,
        Instant createdAt) {
}
