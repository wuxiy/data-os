package com.cywu.dataos.controlplane.quality;

public record GovernanceNotificationDeliveryResult(int processed, int sent, int skipped, int failed) {
}
