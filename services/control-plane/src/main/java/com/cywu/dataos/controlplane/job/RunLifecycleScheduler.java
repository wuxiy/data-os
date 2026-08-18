package com.cywu.dataos.controlplane.job;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/** Thin scheduling trigger; run state transitions belong to IngestionRunService. */
@Service
public class RunLifecycleScheduler {

    private final IngestionRunService lifecycle;

    @Value("${data-os.runs.sync-interval-ms:30000}")
    private long syncIntervalMs;

    @Value("${data-os.runs.sync-initial-delay-ms:10000}")
    private long syncInitialDelayMs;

    @Value("${data-os.runs.submit-lease-ms:120000}")
    private long submitLeaseMs;

    public RunLifecycleScheduler(IngestionRunService lifecycle) {
        this.lifecycle = lifecycle;
    }

    @PostConstruct
    void validateSchedule() {
        if (syncIntervalMs < 1000 || syncIntervalMs > 3_600_000) {
            throw new IllegalStateException("data-os.runs.sync-interval-ms 必须在 1000 到 3600000 毫秒之间");
        }
        if (syncInitialDelayMs < 0 || syncInitialDelayMs > 3_600_000) {
            throw new IllegalStateException("data-os.runs.sync-initial-delay-ms 必须在 0 到 3600000 毫秒之间");
        }
        if (submitLeaseMs < 1000 || submitLeaseMs > 86_400_000) {
            throw new IllegalStateException("data-os.runs.submit-lease-ms 必须在 1000 到 86400000 毫秒之间");
        }
    }

    @Scheduled(
            fixedDelayString = "${data-os.runs.sync-interval-ms:30000}",
            initialDelayString = "${data-os.runs.sync-initial-delay-ms:10000}")
    public void scheduledSync() {
        lifecycle.syncPending();
    }
}
