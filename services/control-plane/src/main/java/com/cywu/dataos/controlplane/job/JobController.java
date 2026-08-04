package com.cywu.dataos.controlplane.job;

import java.net.URI;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/jobs")
public class JobController {

    private final JobService service;

    public JobController(JobService service) {
        this.service = service;
    }

    @GetMapping
    public JobListResponse list(
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId) {
        var items = service.list(tenantId, institutionId);
        return new JobListResponse(items, items.size());
    }

    @PostMapping
    public ResponseEntity<IngestionJob> create(@Valid @RequestBody CreateJobRequest request) {
        var job = service.create(request);
        return ResponseEntity.created(URI.create("/api/v1/jobs/" + job.id())).body(job);
    }

    @PutMapping("/{jobId}/status")
    public IngestionJob changeStatus(@PathVariable String jobId,
                                     @Valid @RequestBody UpdateJobStatusRequest request) {
        return service.changeStatus(jobId, request);
    }

    public record JobListResponse(java.util.List<IngestionJob> items, int total) {
    }
}
