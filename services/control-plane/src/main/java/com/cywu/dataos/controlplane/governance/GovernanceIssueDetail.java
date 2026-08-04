package com.cywu.dataos.controlplane.governance;

import java.util.List;

public record GovernanceIssueDetail(
        GovernanceIssue issue,
        List<GovernanceIssueEvent> events) {
}
