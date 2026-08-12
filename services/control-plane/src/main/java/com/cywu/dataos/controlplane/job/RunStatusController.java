package com.cywu.dataos.controlplane.job;

import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/jobs/{jobId}/runs/{runId}")
public class RunStatusController {

    private final RunStatusSyncService service;

    public RunStatusController(RunStatusSyncService service) {
        this.service = service;
    }

    @PostMapping("/sync")
    public IngestionRun sync(@PathVariable String jobId, @PathVariable String runId) {
        return service.sync(jobId, runId);
    }

    @PostMapping("/reconcile/confirm-absent")
    public IngestionRun confirmAbsent(@PathVariable String jobId, @PathVariable String runId) {
        return service.confirmAbsent(jobId, runId);
    }
}
