package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * A finding emitted by an approved quality workflow (dbt, OpenMetadata or an
 * institution adapter). It is deliberately a result contract, not an SQL or
 * dbt execution contract; ruleId is resolved by the registered runtime.
 */
public record QualityFindingRequest(
        @NotBlank @Size(max = 300) String findingKey,
        @NotBlank @Size(max = 100) String sourceSystem,
        @NotBlank @Size(max = 128) String tenantId,
        @NotBlank @Size(max = 128) String institutionId,
        @NotBlank @Size(max = 300) String title,
        @NotBlank @Size(max = 32) String severity,
        @NotBlank @Size(max = 200) String datasetId,
        @NotBlank @Size(max = 200) String ruleId,
        @NotBlank @Size(max = 200) String ownerDepartment,
        @NotBlank @Size(max = 200) String ownerId,
        @NotBlank @Size(max = 200) String ownerName,
        @Size(max = 128) String ticketId,
        @NotBlank @Size(max = 500) String impact,
        @NotBlank @Size(max = 500) String objectLabel,
        Instant dueAt,
        @NotBlank @Size(max = 128) String executionBatchId,
        @NotNull Boolean passed,
        @Size(max = 20) List<Map<String, Object>> sampleEvidence,
        @Size(max = 1000) String message) {

    public QualityFindingRequest {
        sampleEvidence = sampleEvidence == null ? List.of() : List.copyOf(sampleEvidence);
        ticketId = ticketId == null ? "" : ticketId;
        message = message == null ? "" : message;
        executionBatchId = executionBatchId == null ? "" : executionBatchId.trim();
    }

    public QualityFindingRequest withSampleEvidence(List<Map<String, Object>> safeEvidence) {
        return new QualityFindingRequest(findingKey, sourceSystem, tenantId, institutionId, title, severity,
                datasetId, ruleId, ownerDepartment, ownerId, ownerName, ticketId, impact, objectLabel, dueAt,
                executionBatchId, passed, safeEvidence, message);
    }
}
