package com.cywu.dataos.controlplane.source;

import java.time.Instant;

public record Source(
        String id,
        String tenantId,
        String institutionId,
        String name,
        String systemType,
        String protocol,
        String status,
        Instant createdAt,
        Instant lastCheckedAt,
        String lastCheckMessage) {
}
