package com.cywu.dataos.controlplane.system;

import java.util.List;

import com.cywu.dataos.controlplane.operational.OperationalFacts;

/**
 * Non-sensitive runtime capabilities exposed to the portal.  It intentionally
 * reports configuration state, never URLs, credentials or connection details.
 */
public record RuntimeStatus(
        String mode,
        boolean seedDemoEnabled,
        String qualityExecutor,
        boolean qualityExecutorConfigured,
        boolean demoQualityExecutorEnabled,
        boolean seatunnelConfigured,
        boolean notificationConfigured,
        OperationalFacts operational,
        List<String> warnings) {
}
