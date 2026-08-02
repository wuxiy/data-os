package com.cywu.dataos.controlplane.governance;

import java.time.Instant;
import java.util.List;

public record GovernanceSummary(
        Instant asOf,
        String tenantId,
        String institutionId,
        List<Metric> metrics,
        List<GovernanceIssue> issues) {
}
