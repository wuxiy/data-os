package com.cywu.dataos.controlplane.quality;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Time-based adapter for quality outcome polling and SLA scans. */
@Component
public final class QualityOutcomeScheduler {

    private final QualityOutcomeService outcomes;
    private final long pollIntervalMs;
    private final long pollInitialDelayMs;
    private final long slaScanIntervalMs;
    private final long slaScanInitialDelayMs;

    public QualityOutcomeScheduler(
            QualityOutcomeService outcomes,
            @Value("${data-os.quality.poll-interval-ms:30000}") long pollIntervalMs,
            @Value("${data-os.quality.poll-initial-delay-ms:10000}") long pollInitialDelayMs,
            @Value("${data-os.quality.sla-scan-interval-ms:60000}") long slaScanIntervalMs,
            @Value("${data-os.quality.sla-scan-initial-delay-ms:15000}") long slaScanInitialDelayMs) {
        this.outcomes = outcomes;
        this.pollIntervalMs = pollIntervalMs;
        this.pollInitialDelayMs = pollInitialDelayMs;
        this.slaScanIntervalMs = slaScanIntervalMs;
        this.slaScanInitialDelayMs = slaScanInitialDelayMs;
    }

    @PostConstruct
    void validateSchedule() {
        validateDelay("data-os.quality.poll-interval-ms", pollIntervalMs, 1_000, 3_600_000);
        validateDelay("data-os.quality.poll-initial-delay-ms", pollInitialDelayMs, 0, 3_600_000);
        validateDelay("data-os.quality.sla-scan-interval-ms", slaScanIntervalMs, 1_000, 3_600_000);
        validateDelay("data-os.quality.sla-scan-initial-delay-ms", slaScanInitialDelayMs, 0, 3_600_000);
    }

    @Scheduled(
            fixedDelayString = "${data-os.quality.poll-interval-ms:30000}",
            initialDelayString = "${data-os.quality.poll-initial-delay-ms:10000}")
    public void scheduledSync() {
        outcomes.syncPending();
    }

    @Scheduled(
            fixedDelayString = "${data-os.quality.sla-scan-interval-ms:60000}",
            initialDelayString = "${data-os.quality.sla-scan-initial-delay-ms:15000}")
    public void scheduledSlaScan() {
        outcomes.scanOverdue();
    }

    private void validateDelay(String name, long value, long min, long max) {
        if (value < min || value > max) {
            throw new IllegalStateException(name + " 必须在 " + min + " 到 " + max + " 毫秒之间");
        }
    }
}
