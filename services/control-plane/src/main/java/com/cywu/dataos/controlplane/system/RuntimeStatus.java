package com.cywu.dataos.controlplane.system;

import java.util.List;

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
        List<String> warnings) {
}
