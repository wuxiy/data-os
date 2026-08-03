package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.Map;

public record IngestionJobConfig(
        String jobId,
        String templateKey,
        int templateVersion,
        Map<String, Object> config,
        Instant updatedAt) {
}
