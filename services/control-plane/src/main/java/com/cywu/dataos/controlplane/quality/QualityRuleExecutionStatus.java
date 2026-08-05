package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record QualityRuleExecutionStatus(
        String status,
        Boolean passed,
        String message,
        String executionBatchId,
        List<Map<String, Object>> sampleEvidence,
        Instant startedAt,
        Instant finishedAt) {

    public QualityRuleExecutionStatus {
        sampleEvidence = sampleEvidence == null ? List.of() : List.copyOf(sampleEvidence);
    }
}
