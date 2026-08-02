package com.cywu.dataos.controlplane.source;

import jakarta.validation.constraints.NotBlank;

public record CreateSourceRequest(
        String tenantId,
        String institutionId,
        @NotBlank(message = "name 不能为空") String name,
        @NotBlank(message = "systemType 不能为空") String systemType,
        @NotBlank(message = "protocol 不能为空") String protocol) {
}
