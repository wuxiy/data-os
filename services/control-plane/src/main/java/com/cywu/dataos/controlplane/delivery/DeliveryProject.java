package com.cywu.dataos.controlplane.delivery;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 交付项目（{@code data_os.delivery_project} 表）。
 */
public record DeliveryProject(
        String id,
        String tenantId,
        String code,
        String name,
        String scope,
        String owner,
        LocalDate targetDate,
        DeliveryLifecycle status,
        String acceptedSnapshotId,
        String createdBy,
        Instant createdAt,
        Instant updatedAt) {
}
