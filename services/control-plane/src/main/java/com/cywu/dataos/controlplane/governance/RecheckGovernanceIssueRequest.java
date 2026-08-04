package com.cywu.dataos.controlplane.governance;

import jakarta.validation.constraints.Size;

public record RecheckGovernanceIssueRequest(@Size(max = 1000, message = "note 不能超过 1000 个字符") String note) {
}
