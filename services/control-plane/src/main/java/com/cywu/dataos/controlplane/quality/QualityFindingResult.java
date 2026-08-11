package com.cywu.dataos.controlplane.quality;

public record QualityFindingResult(
        String issueId,
        String status,
        boolean issueCreated,
        boolean passed,
        String executionBatchId,
        String message) {
}
