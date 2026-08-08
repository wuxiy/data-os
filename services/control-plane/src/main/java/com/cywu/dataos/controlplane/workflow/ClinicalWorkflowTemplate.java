package com.cywu.dataos.controlplane.workflow;

import java.util.List;
import java.util.Map;

/**
 * A versioned, product-facing ingestion contract for a clinical system.
 *
 * <p>The sample configuration is intentionally credential-free. Operators
 * copy it into a job only after replacing the endpoint and credentialRef with
 * values belonging to the current tenant/institution.</p>
 */
public record ClinicalWorkflowTemplate(
        String key,
        int version,
        String displayName,
        String systemType,
        String protocol,
        String executor,
        String mode,
        String description,
        List<String> requiredCredentialRoles,
        Map<String, Object> sampleConfig) {
}
