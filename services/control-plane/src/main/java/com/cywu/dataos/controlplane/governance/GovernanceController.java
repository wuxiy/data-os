package com.cywu.dataos.controlplane.governance;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/governance")
public class GovernanceController {

    private final GovernanceService service;

    public GovernanceController(GovernanceService service) {
        this.service = service;
    }

    @GetMapping("/summary")
    public GovernanceSummary summary(
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId) {
        return service.summary(tenantId, institutionId);
    }
}
