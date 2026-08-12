package com.cywu.dataos.controlplane.operational;

import java.util.List;
import java.util.Locale;

/** Stable, non-sensitive aggregation shared by operational HTTP consumers. */
public record OperationalFacts(State state, int ready, int degraded, int unknown, int total) {

    public enum State {
        READY,
        DEGRADED,
        UNKNOWN
    }

    public static OperationalFacts from(List<String> statuses) {
        var ready = 0;
        var degraded = 0;
        var unknown = 0;
        for (var value : statuses == null ? List.<String>of() : statuses) {
            var normalized = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
            switch (normalized) {
                case "UP", "READY" -> ready++;
                case "DOWN", "DEGRADED", "FAILED", "UNAVAILABLE" -> degraded++;
                default -> unknown++;
            }
        }
        var state = degraded > 0 || (ready > 0 && unknown > 0)
                ? State.DEGRADED
                : ready > 0 ? State.READY : State.UNKNOWN;
        return new OperationalFacts(state, ready, degraded, unknown, ready + degraded + unknown);
    }
}
