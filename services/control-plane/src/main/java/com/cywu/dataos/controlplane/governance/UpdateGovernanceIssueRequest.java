package com.cywu.dataos.controlplane.governance;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record UpdateGovernanceIssueRequest(
        @NotBlank(message = "status 不能为空") String status,
        @NotBlank(message = "note 不能为空") @Size(max = 1000, message = "note 不能超过 1000 个字符") String note) {
}
