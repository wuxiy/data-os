package com.cywu.dataos.controlplane.quality;

import java.time.Instant;

import com.cywu.dataos.controlplane.governance.GovernanceIssueEvent;
import com.cywu.dataos.controlplane.governance.GovernanceRepository;
import com.cywu.dataos.controlplane.run.RunTerminalEffects;

/**
 * 质量复检终态的业务效果：与终态回写同事务地推进治理问题工作流、
 * 记录事件并排队通知；任何一步失败，终态写入一并回滚。
 */
public class QualityRecheckEffects implements RunTerminalEffects<QualityRuleRun, QualityResultPayload> {

    private final GovernanceRepository repository;
    private final NotificationService notifications;

    public QualityRecheckEffects(GovernanceRepository repository, NotificationService notifications) {
        this.repository = repository;
        this.notifications = notifications;
    }

    @Override
    public void onTerminal(QualityRuleRun run, String status, QualityResultPayload payload) {
        var issue = repository.findIssue(run.issueId(), run.tenantId(), run.institutionId()).orElse(null);
        var persisted = repository.findQualityRun(run.id(), run.issueId(), run.tenantId(),
                run.institutionId()).orElse(null);
        if (issue == null || persisted == null || !"RECHECKING".equals(issue.status())) {
            return;
        }
        var pass = "SUCCEEDED".equals(persisted.status()) && Boolean.TRUE.equals(persisted.passed());
        var returned = !pass;
        var targetStatus = returned ? "RETURNED" : "CLOSED";
        var action = returned
                ? ("SUCCEEDED".equals(persisted.status()) ? "AUTO_RETURNED" : "RECHECK_FAILED")
                : "AUTO_CLOSED";
        var note = persisted.resultMessage() == null
                ? (returned ? "复检未通过，已退回治理" : "复检通过，已自动关闭")
                : persisted.resultMessage();
        var now = Instant.now();
        if (repository.updateIssueAfterQualityResult(issue.id(), issue.tenantId(), issue.institutionId(),
                targetStatus, note, action, now) == 1) {
            var eventId = repository.insertEvent(issue.id(), action, note, "质量复检编排器", now);
            var event = new GovernanceIssueEvent(eventId, issue.id(), action, note, "质量复检编排器", now);
            notifications.enqueue(issue, event,
                    returned ? "质量复检未通过，问题已退回" : "质量复检通过，问题已自动关闭",
                    "问题「" + issue.title() + "」的执行批次 " + persisted.executionBatchId() + " 已完成：" + note);
        }
    }

    @Override
    public void onSubmissionFailed(QualityRuleRun run, String status, String message) {
        var issue = repository.findIssue(run.issueId(), run.tenantId(), run.institutionId()).orElse(null);
        if (issue == null) {
            return;
        }
        var now = Instant.now();
        if (repository.updateIssueAfterQualityResult(issue.id(), run.tenantId(), run.institutionId(),
                "RETURNED", "复检提交失败：" + message, "RECHECK_SUBMIT_FAILED", now) == 1) {
            var eventId = repository.insertEvent(issue.id(), "RECHECK_SUBMIT_FAILED", message,
                    "质量复检编排器", now);
            var event = new GovernanceIssueEvent(eventId, issue.id(), "RECHECK_SUBMIT_FAILED", message,
                    "质量复检编排器", now);
            notifications.enqueue(issue, event, "质量复检提交失败",
                    "问题「" + issue.title() + "」未能投递到质量规则执行器：" + message);
        }
    }
}
