package com.cywu.dataos.controlplane.governance;

import java.time.Instant;

import org.springframework.stereotype.Service;

@Service
public class GovernanceService {

    private final GovernanceRepository repository;

    public GovernanceService(GovernanceRepository repository) {
        this.repository = repository;
    }

    public GovernanceSummary summary(String tenantId, String institutionId) {
        var resolvedTenant = defaultValue(tenantId, "default");
        var resolvedInstitution = defaultValue(institutionId, "demo-hospital");
        return new GovernanceSummary(
                Instant.now(),
                resolvedTenant,
                resolvedInstitution,
                repository.findMetrics(resolvedTenant, resolvedInstitution),
                repository.findIssues(resolvedTenant, resolvedInstitution));
    }

    private String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
