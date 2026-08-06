package com.cywu.dataos.controlplane.governance;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestBody;

import jakarta.validation.Valid;
import com.cywu.dataos.controlplane.quality.GovernanceNotificationDeliveryResult;
import com.cywu.dataos.controlplane.quality.GovernanceSlaScanResult;
import com.cywu.dataos.controlplane.quality.NotificationService;
import com.cywu.dataos.controlplane.quality.QualityWorkflowService;
import com.cywu.dataos.controlplane.security.TenantScope;

@RestController
@RequestMapping("/api/v1/governance")
public class GovernanceController {

    private final GovernanceService service;
    private final QualityWorkflowService qualityWorkflow;
    private final NotificationService notifications;
    private final TenantScope tenantScope;

    public GovernanceController(GovernanceService service, QualityWorkflowService qualityWorkflow,
                                NotificationService notifications, TenantScope tenantScope) {
        this.service = service;
        this.qualityWorkflow = qualityWorkflow;
        this.notifications = notifications;
        this.tenantScope = tenantScope;
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

    @PostMapping("/issues/{issueId}/runs/{runId}/sync")
    public GovernanceIssueDetail syncQualityRun(
            @PathVariable String issueId,
            @PathVariable String runId,
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId) {
        return qualityWorkflow.sync(issueId, runId, tenantId, institutionId);
    }

    @PostMapping("/issues/{issueId}/notifications/remind")
    public GovernanceIssueDetail remindOwner(
            @PathVariable String issueId,
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        notifications.remind(issueId, scope.tenantId(), scope.institutionId(), idempotencyKey);
        return service.detail(issueId, scope.tenantId(), scope.institutionId());
    }

    @PostMapping("/sla/scan")
    public GovernanceSlaScanResult scanSla(
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId) {
        return qualityWorkflow.scanSla(tenantId, institutionId);
    }

    @PostMapping("/notifications/deliver")
    public GovernanceNotificationDeliveryResult deliverNotifications() {
        var summary = notifications.deliverPending();
        return new GovernanceNotificationDeliveryResult(summary.processed(), summary.sent(),
                summary.skipped(), summary.failed());
    }
}
