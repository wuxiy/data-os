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
        String artifactUri,
        Instant startedAt,
        Instant finishedAt,
        Double score,
        Long totalRows,
        Long dirtyRows) {

    public QualityRuleExecutionStatus {
        sampleEvidence = sampleEvidence == null ? List.of() : List.copyOf(sampleEvidence);
    }

    /** 既有八参形态（DEMO 执行器与缺省路径不带评分）。 */
    public QualityRuleExecutionStatus(String status, Boolean passed, String message,
                                      String executionBatchId,
                                      List<Map<String, Object>> sampleEvidence,
                                      String artifactUri, Instant startedAt, Instant finishedAt) {
        this(status, passed, message, executionBatchId, sampleEvidence, artifactUri,
                startedAt, finishedAt, null, null, null);
    }
}
