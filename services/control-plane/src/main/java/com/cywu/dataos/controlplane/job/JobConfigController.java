package com.cywu.dataos.controlplane.job;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/jobs/{jobId}/config")
public class JobConfigController {

    private final JobConfigService service;

    public JobConfigController(JobConfigService service) {
        this.service = service;
    }

    @GetMapping
    public IngestionJobConfig get(@PathVariable String jobId) {
        return service.get(jobId);
    }

    @PutMapping
    public IngestionJobConfig save(@PathVariable String jobId,
                                   @Valid @RequestBody SaveJobConfigRequest request) {
        return service.save(jobId, request);
    }
}
