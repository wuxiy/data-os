package com.cywu.dataos.controlplane.governance;

import java.time.Instant;
import java.util.List;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GovernanceService {

    private final GovernanceRepository repository;

    public GovernanceService(GovernanceRepository repository) {
        this.repository = repository;
    }

    public GovernanceSummary summary(String tenantId, String institutionId) {
        var resolvedTenant = defaultValue(tenantId, "default");
        var resolvedInstitution = defaultValue(institutionId, "demo-hospital");
        return new GovernanceSummary(
                Instant.now(),
                resolvedTenant,
                resolvedInstitution,
                repository.findMetrics(resolvedTenant, resolvedInstitution),
                repository.findIssues(resolvedTenant, resolvedInstitution));
    }

    public GovernanceIssueList listIssues(String tenantId, String institutionId, String status, String query) {
        var items = repository.findIssues(defaultValue(tenantId, "default"),
                defaultValue(institutionId, "demo-hospital"), status, query);
        return new GovernanceIssueList(items, items.size());
    }

    public GovernanceIssueDetail detail(String issueId, String tenantId, String institutionId) {
        var issue = require(issueId, tenantId, institutionId);
        return new GovernanceIssueDetail(issue, repository.findEvents(issue.id()));
    }

    @Transactional
    public GovernanceIssueDetail updateWorkflow(String issueId, String tenantId, String institutionId,
                                                 UpdateGovernanceIssueRequest request) {
        var resolvedTenant = defaultValue(tenantId, "default");
        var resolvedInstitution = defaultValue(institutionId, "demo-hospital");
        require(issueId, resolvedTenant, resolvedInstitution);
        var status = normalizeStatus(request.status());
        var now = Instant.now();
        var updated = repository.updateWorkflow(issueId, resolvedTenant, resolvedInstitution, status,
                request.note().trim(), now, "WORKFLOW_UPDATED");
        if (updated != 1) throw new ResourceNotFoundException("未找到治理问题：" + issueId);
        repository.insertEvent(issueId, "WORKFLOW_UPDATED", request.note().trim(), "当前治理负责人", now);
        return detail(issueId, resolvedTenant, resolvedInstitution);
    }

    @Transactional
    public GovernanceIssueDetail requestRecheck(String issueId, String tenantId, String institutionId,
                                                RecheckGovernanceIssueRequest request) {
        var resolvedTenant = defaultValue(tenantId, "default");
        var resolvedInstitution = defaultValue(institutionId, "demo-hospital");
        var current = require(issueId, resolvedTenant, resolvedInstitution);
        if ("CLOSED".equals(current.status())) {
            throw new ConflictException("已关闭的治理问题不能直接复检");
        }
        if ("RECHECKING".equals(current.status())) {
            throw new ConflictException("治理问题已在复检中，请等待结果");
        }
        var now = Instant.now();
        var note = request == null || request.note() == null || request.note().isBlank()
                ? "已按原质量规则发起复检"
                : request.note().trim();
        var updated = repository.updateWorkflow(issueId, resolvedTenant, resolvedInstitution, "RECHECKING",
                current.processingNote(), now, "RECHECK_REQUESTED");
        if (updated != 1) throw new ResourceNotFoundException("未找到治理问题：" + issueId);
        repository.insertEvent(issueId, "RECHECK_REQUESTED", note, "当前治理负责人", now);
        return detail(issueId, resolvedTenant, resolvedInstitution);
    }

    private GovernanceIssue require(String issueId, String tenantId, String institutionId) {
        return repository.findIssue(issueId, defaultValue(tenantId, "default"), defaultValue(institutionId, "demo-hospital"))
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
    }

    private String normalizeStatus(String status) {
        var normalized = status == null ? "" : status.trim().toUpperCase();
        if (!List.of("OVERDUE", "IN_PROGRESS", "PENDING", "PENDING_RECHECK", "RECHECKING", "CLOSED").contains(normalized)) {
            throw new com.cywu.dataos.controlplane.api.InvalidRequestException("不支持的治理问题状态：" + status);
        }
        return normalized;
    }

    private String defaultValue(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
