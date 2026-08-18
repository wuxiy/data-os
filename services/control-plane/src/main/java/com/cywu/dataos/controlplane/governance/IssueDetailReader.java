package com.cywu.dataos.controlplane.governance;

import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.quality.QualityRunRepository;
import org.springframework.stereotype.Component;

/**
 * 治理问题详情的统一装配：问题、事件、最新/历史质量运行与通知。
 * 治理驾驶舱与质量闭环两个入口共用同一份装配，避免视图漂移。
 */
@Component
public class IssueDetailReader {

    private final IssueRepository issues;
    private final QualityRunRepository runs;
    private final NotificationOutboxRepository outbox;

    public IssueDetailReader(IssueRepository issues, QualityRunRepository runs,
                             NotificationOutboxRepository outbox) {
        this.issues = issues;
        this.runs = runs;
        this.outbox = outbox;
    }

    public GovernanceIssueDetail read(String issueId, String tenantId, String institutionId) {
        var issue = issues.findIssue(issueId, tenantId, institutionId)
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
        return new GovernanceIssueDetail(issue, issues.findEvents(issueId),
                runs.findLatestQualityRun(issueId, tenantId, institutionId).orElse(null),
                runs.findQualityRuns(issueId, tenantId, institutionId), outbox.findNotifications(issueId));
    }
}
