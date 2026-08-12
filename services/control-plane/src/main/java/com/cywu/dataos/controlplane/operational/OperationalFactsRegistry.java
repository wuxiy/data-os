package com.cywu.dataos.controlplane.operational;

import org.springframework.stereotype.Component;

/**
 * Owns the three facts that define the lightweight core path. Optional
 * technical components keep their detailed probe status but do not change the
 * aggregate readiness of ingestion, quality closure and notification.
 */
@Component
public final class OperationalFactsRegistry {

    private volatile String qualityExecutor = "UNKNOWN";
    private volatile String seaTunnel = "UNKNOWN";
    private volatile String notification = "UNKNOWN";
    private volatile boolean qualityExecutorConfigured;
    private volatile boolean seaTunnelConfigured;
    private volatile boolean notificationConfigured;

    public synchronized void updateConfiguration(boolean qualityExecutorConfigured,
                                                 boolean seaTunnelConfigured,
                                                 boolean notificationConfigured) {
        this.qualityExecutorConfigured = qualityExecutorConfigured;
        this.seaTunnelConfigured = seaTunnelConfigured;
        this.notificationConfigured = notificationConfigured;
        if (!qualityExecutorConfigured) qualityExecutor = "UNKNOWN";
        if (!seaTunnelConfigured) seaTunnel = "UNKNOWN";
        if (!notificationConfigured) notification = "UNKNOWN";
    }

    public synchronized void updateQualityExecutor(String status) {
        qualityExecutor = qualityExecutorConfigured ? status : "UNKNOWN";
    }

    public synchronized void updateSeaTunnel(String status) {
        seaTunnel = seaTunnelConfigured ? status : "UNKNOWN";
    }

    public synchronized void updateNotification(String status) {
        notification = notificationConfigured ? status : "UNKNOWN";
    }

    public synchronized OperationalFacts snapshot() {
        return OperationalFacts.from(java.util.List.of(qualityExecutor, seaTunnel, notification));
    }
}
