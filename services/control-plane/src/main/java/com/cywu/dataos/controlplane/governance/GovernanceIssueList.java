package com.cywu.dataos.controlplane.governance;

import java.util.List;

public record GovernanceIssueList(
        List<GovernanceIssue> items,
        int total) {
}
