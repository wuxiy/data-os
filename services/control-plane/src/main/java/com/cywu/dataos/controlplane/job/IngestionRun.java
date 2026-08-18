package com.cywu.dataos.controlplane.job;

import java.time.Instant;

import com.cywu.dataos.controlplane.run.ExternalRun;

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
        Instant finishedAt) implements ExternalRun {

    public IngestionRun(String id, String jobId, String status, String executor,
                        String externalId, String message, Instant submittedAt,
                        Instant startedAt, Instant finishedAt) {
        this(id, jobId, status, executor, externalId, message, null, null,
                submittedAt, startedAt, finishedAt);
    }
}
