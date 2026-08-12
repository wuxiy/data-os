package com.cywu.dataos.controlplane.executor;

/**
 * Result of looking up an external run by the durable data-os run id.
 *
 * <p>Adapters must distinguish a reliable lookup from a situation that needs
 * an operator decision.  A missing result is never treated as permission to
 * submit a second external run automatically.</p>
 */
public record AdapterReconciliation(
        Outcome outcome,
        String externalId,
        AdapterRunStatus status,
        String message) {

    public enum Outcome {
        FOUND,
        NOT_FOUND,
        MANUAL_REQUIRED
    }

    public static AdapterReconciliation found(String externalId, AdapterRunStatus status, String message) {
        return new AdapterReconciliation(Outcome.FOUND, externalId, status, message);
    }

    public static AdapterReconciliation notFound(String message) {
        return new AdapterReconciliation(Outcome.NOT_FOUND, null, null, message);
    }

    public static AdapterReconciliation manualRequired(String message) {
        return new AdapterReconciliation(Outcome.MANUAL_REQUIRED, null, null, message);
    }
}
