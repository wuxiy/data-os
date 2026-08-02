package com.cywu.dataos.controlplane.job;

import java.time.Instant;

public record IngestionJob(
        String id,
        String sourceId,
        String name,
        String mode,
        String executor,
        String status,
        Instant createdAt,
        Instant lastRunAt) {
}
