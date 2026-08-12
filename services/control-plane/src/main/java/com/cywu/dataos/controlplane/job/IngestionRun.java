package com.cywu.dataos.controlplane.job;

import java.time.Instant;

public record IngestionRun(
        String id,
        String jobId,
        String status,
        String executor,
        String externalId,
        String message,
        String reconciliationStatus,
        String reconciliationMessage,
        Instant submittedAt,
        Instant startedAt,
        Instant finishedAt) {

    public IngestionRun(String id, String jobId, String status, String executor,
                        String externalId, String message, Instant submittedAt,
                        Instant startedAt, Instant finishedAt) {
        this(id, jobId, status, executor, externalId, message, null, null,
                submittedAt, startedAt, finishedAt);
    }
}
