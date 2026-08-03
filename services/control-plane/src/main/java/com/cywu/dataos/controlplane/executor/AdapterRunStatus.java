package com.cywu.dataos.controlplane.executor;

import java.time.Instant;

/**
 * Executor-neutral run status returned by an adapter status query.
 */
public record AdapterRunStatus(
        String status,
        String message,
        Instant startedAt,
        Instant finishedAt) {
}
