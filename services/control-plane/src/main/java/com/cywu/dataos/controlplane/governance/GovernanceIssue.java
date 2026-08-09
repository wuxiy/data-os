package com.cywu.dataos.controlplane.governance;

import java.time.Instant;

public record GovernanceIssue(
        String id,
        String tenantId,
        String institutionId,
        String title,
        String severity,
        String status,
        String datasetId,
        String ruleId,
        String ownerDepartment,
        String ownerId,
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
