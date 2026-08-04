package com.cywu.dataos.controlplane.job;

import jakarta.validation.constraints.NotBlank;

public record UpdateJobStatusRequest(
        @NotBlank(message = "status 不能为空") String status) {
}
