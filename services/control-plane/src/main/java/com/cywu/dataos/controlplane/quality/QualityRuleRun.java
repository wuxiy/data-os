package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.run.ExternalRun;

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
        String artifactUri,
        String reconciliationStatus,
        String reconciliationMessage,
        Instant submittedAt,
        Instant startedAt,
        Instant finishedAt,
        int attemptCount,
        Instant nextPollAt,
        String lastError,
        Instant updatedAt,
        Double score,
        Long totalRows,
        Long dirtyRows) implements ExternalRun {

    public QualityRuleRun {
        sampleEvidence = sampleEvidence == null ? List.of() : List.copyOf(sampleEvidence);
    }

    /** 既有无分形态（外部 finding 路径与历史构造点）。 */
    public QualityRuleRun(
            String id, String issueId, String tenantId, String institutionId,
            String ruleId, String datasetId, String executor, String status,
            String externalId, String executionBatchId, Boolean passed, String resultMessage,
            List<Map<String, Object>> sampleEvidence, String artifactUri,
            String reconciliationStatus, String reconciliationMessage,
            Instant submittedAt, Instant startedAt, Instant finishedAt,
            int attemptCount, Instant nextPollAt, String lastError, Instant updatedAt) {
        this(id, issueId, tenantId, institutionId, ruleId, datasetId, executor, status,
                externalId, executionBatchId, passed, resultMessage, sampleEvidence, artifactUri,
                reconciliationStatus, reconciliationMessage, submittedAt, startedAt, finishedAt,
                attemptCount, nextPollAt, lastError, updatedAt, null, null, null);
    }

    public boolean terminal() {
        return "SUCCEEDED".equals(status) || "FAILED".equals(status)
                || "CANCELED".equals(status) || "SUBMIT_FAILED".equals(status);
    }
}
