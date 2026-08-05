package com.cywu.dataos.controlplane.governance;

import java.util.List;

import com.cywu.dataos.controlplane.quality.QualityRuleRun;

public record GovernanceIssueDetail(
        GovernanceIssue issue,
        List<GovernanceIssueEvent> events,
        QualityRuleRun latestRun,
        List<QualityRuleRun> runs,
        List<GovernanceNotification> notifications) {

    public GovernanceIssueDetail {
        events = events == null ? List.of() : List.copyOf(events);
        runs = runs == null ? List.of() : List.copyOf(runs);
        notifications = notifications == null ? List.of() : List.copyOf(notifications);
    }
}
