package com.cywu.dataos.controlplane.governance;

import java.math.BigDecimal;

public record Metric(
        String key,
        String label,
        BigDecimal value,
        String unit,
        BigDecimal target,
        String detail,
        String tone) {
}
