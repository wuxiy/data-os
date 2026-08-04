package com.cywu.dataos.controlplane.governance;

import java.time.Instant;

public record GovernanceIssueEvent(
        String id,
        String issueId,
        String eventType,
        String note,
        String actor,
        Instant createdAt) {
}
