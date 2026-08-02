package com.cywu.dataos.controlplane.job;

import java.time.Instant;

public record IngestionRun(
        String id,
        String jobId,
        String status,
        String executor,
        String externalId,
        String message,
        Instant submittedAt,
        Instant startedAt,
        Instant finishedAt) {
}
