package com.cywu.dataos.controlplane.source;

public record SourceCheckResult(String status, String message) {

    static SourceCheckResult healthy(String message) {
        return new SourceCheckResult("HEALTHY", message);
    }

    static SourceCheckResult blockedConfiguration(String message) {
        return new SourceCheckResult("BLOCKED_CONFIGURATION", message);
    }

    static SourceCheckResult unhealthy(String message) {
        return new SourceCheckResult("UNHEALTHY", message);
    }
}
