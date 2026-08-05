package com.cywu.dataos.controlplane.quality;

/**
 * Executor-neutral request for one governance issue recheck.
 */
public record QualityRuleExecutionRequest(
        String issueId,
        String tenantId,
        String institutionId,
        String title,
        String ruleId,
        String datasetId,
        String executionBatchId) {
}
