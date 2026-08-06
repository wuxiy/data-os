package com.cywu.dataos.controlplane.governance;

import java.time.Instant;
import java.util.List;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.quality.QualityWorkflowService;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GovernanceService {

    private final GovernanceRepository repository;
    private final QualityWorkflowService qualityWorkflow;
    private final TenantScope tenantScope;

    public GovernanceService(GovernanceRepository repository, QualityWorkflowService qualityWorkflow,
                             TenantScope tenantScope) {
        this.repository = repository;
        this.qualityWorkflow = qualityWorkflow;
        this.tenantScope = tenantScope;
    }

    public GovernanceSummary summary(String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var resolvedTenant = scope.tenantId();
        var resolvedInstitution = scope.institutionId();
        return new GovernanceSummary(
                Instant.now(),
                resolvedTenant,
                resolvedInstitution,
                repository.findMetrics(resolvedTenant, resolvedInstitution),
                repository.findIssues(resolvedTenant, resolvedInstitution));
    }

    public GovernanceIssueList listIssues(String tenantId, String institutionId, String status, String query) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var items = repository.findIssues(scope.tenantId(), scope.institutionId(), status, query);
        return new GovernanceIssueList(items, items.size());
    }

    public GovernanceIssueDetail detail(String issueId, String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var issue = require(issueId, scope.tenantId(), scope.institutionId());
        var tenant = scope.tenantId();
        var institution = scope.institutionId();
        return new GovernanceIssueDetail(issue, repository.findEvents(issue.id()),
                repository.findLatestQualityRun(issue.id(), tenant, institution).orElse(null),
                repository.findQualityRuns(issue.id(), tenant, institution), repository.findNotifications(issue.id()));
    }

    @Transactional
    public GovernanceIssueDetail updateWorkflow(String issueId, String tenantId, String institutionId,
                                                 UpdateGovernanceIssueRequest request) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var resolvedTenant = scope.tenantId();
        var resolvedInstitution = scope.institutionId();
        var current = require(issueId, resolvedTenant, resolvedInstitution);
        if ("RECHECKING".equals(current.status())) {
            throw new ConflictException("治理问题正在复检中，不能改写工作流状态");
        }
        var status = normalizeStatus(request.status());
        var now = Instant.now();
        var updated = repository.updateWorkflow(issueId, resolvedTenant, resolvedInstitution, status,
                request.note().trim(), now, "WORKFLOW_UPDATED");
        if (updated != 1) throw new ResourceNotFoundException("未找到治理问题：" + issueId);
        repository.insertEvent(issueId, "WORKFLOW_UPDATED", request.note().trim(), "当前治理负责人", now);
        return detail(issueId, resolvedTenant, resolvedInstitution);
    }

    public GovernanceIssueDetail requestRecheck(String issueId, String tenantId, String institutionId,
                                                RecheckGovernanceIssueRequest request) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var resolvedTenant = scope.tenantId();
        var resolvedInstitution = scope.institutionId();
        var note = request == null || request.note() == null || request.note().isBlank()
                ? "已按原质量规则发起复检"
                : request.note().trim();
        return qualityWorkflow.requestRecheck(issueId, resolvedTenant, resolvedInstitution, note);
    }

    private GovernanceIssue require(String issueId, String tenantId, String institutionId) {
        return repository.findIssue(issueId, tenantId, institutionId)
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
    }

    private String normalizeStatus(String status) {
        var normalized = status == null ? "" : status.trim().toUpperCase(java.util.Locale.ROOT);
        if (!List.of("OVERDUE", "IN_PROGRESS", "PENDING", "PENDING_RECHECK", "RETURNED", "CLOSED").contains(normalized)) {
            throw new com.cywu.dataos.controlplane.api.InvalidRequestException("不支持的治理问题状态：" + status);
        }
        return normalized;
    }

}
