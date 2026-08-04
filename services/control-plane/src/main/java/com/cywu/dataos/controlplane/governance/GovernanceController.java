package com.cywu.dataos.controlplane.governance;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestBody;

import jakarta.validation.Valid;

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

    @GetMapping("/issues")
    public GovernanceIssueList issues(
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String query) {
        return service.listIssues(tenantId, institutionId, status, query);
    }

    @GetMapping("/issues/{issueId}")
    public GovernanceIssueDetail issue(
            @PathVariable String issueId,
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId) {
        return service.detail(issueId, tenantId, institutionId);
    }

    @PutMapping("/issues/{issueId}/workflow")
    public GovernanceIssueDetail updateWorkflow(
            @PathVariable String issueId,
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId,
            @Valid @RequestBody UpdateGovernanceIssueRequest request) {
        return service.updateWorkflow(issueId, tenantId, institutionId, request);
    }

    @PostMapping("/issues/{issueId}/recheck")
    public GovernanceIssueDetail requestRecheck(
            @PathVariable String issueId,
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId,
            @Valid @RequestBody(required = false) RecheckGovernanceIssueRequest request) {
        return service.requestRecheck(issueId, tenantId, institutionId, request);
    }
}
