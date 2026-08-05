package com.cywu.dataos.controlplane.governance;

import java.time.Instant;

public record GovernanceIssue(
        String id,
        String title,
        String severity,
        String status,
        String datasetId,
        String ruleId,
        String ownerDepartment,
        String ownerName,
        String ticketId,
        String impact,
        Instant dueAt,
        String objectLabel,
        String processingNote,
        Instant updatedAt,
        Instant lastActionAt,
        String lastAction,
        Instant slaOverdueAt) {
}
