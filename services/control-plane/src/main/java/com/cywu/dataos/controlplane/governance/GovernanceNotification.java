package com.cywu.dataos.controlplane.governance;

import java.time.Instant;

public record GovernanceNotification(
        String id,
        String issueId,
        String eventId,
        String channel,
        String recipient,
        String subject,
        String body,
        String status,
        String idempotencyKey,
        int attemptCount,
        String lastError,
        Instant nextAttemptAt,
        Instant lockedUntil,
        String lockedBy,
        Instant sentAt,
        Instant createdAt,
        Instant updatedAt) {
}
