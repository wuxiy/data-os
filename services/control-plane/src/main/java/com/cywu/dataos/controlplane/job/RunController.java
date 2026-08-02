package com.cywu.dataos.controlplane.job;

import java.net.URI;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/jobs/{jobId}/runs")
public class RunController {

    private final RunService service;

    public RunController(RunService service) {
        this.service = service;
    }

    @GetMapping
    public RunListResponse list(@PathVariable String jobId) {
        var items = service.list(jobId);
        return new RunListResponse(items, items.size());
    }

    @PostMapping
    public ResponseEntity<IngestionRun> start(
            @PathVariable String jobId,
            @Valid @RequestBody(required = false) CreateRunRequest request) {
        var run = service.start(jobId, request == null ? new CreateRunRequest(java.util.Map.of()) : request);
        return ResponseEntity.created(URI.create("/api/v1/jobs/" + jobId + "/runs/" + run.id())).body(run);
    }

    public record RunListResponse(java.util.List<IngestionRun> items, int total) {
    }
}
