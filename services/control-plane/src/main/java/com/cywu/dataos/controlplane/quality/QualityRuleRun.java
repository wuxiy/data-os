package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record QualityRuleRun(
        String id,
        String issueId,
        String tenantId,
        String institutionId,
        String ruleId,
        String datasetId,
        String executor,
        String status,
        String externalId,
        String executionBatchId,
        Boolean passed,
        String resultMessage,
        List<Map<String, Object>> sampleEvidence,
        Instant submittedAt,
        Instant startedAt,
        Instant finishedAt,
        int attemptCount,
        Instant nextPollAt,
        String lastError,
        Instant updatedAt) {

    public QualityRuleRun {
        sampleEvidence = sampleEvidence == null ? List.of() : List.copyOf(sampleEvidence);
    }

    public boolean terminal() {
        return "SUCCEEDED".equals(status) || "FAILED".equals(status)
                || "CANCELED".equals(status) || "SUBMIT_FAILED".equals(status);
    }
}
