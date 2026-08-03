package com.cywu.dataos.controlplane.job;

import java.util.Map;

import jakarta.validation.constraints.NotBlank;

public record CreateJobRequest(
        @NotBlank(message = "sourceId 不能为空") String sourceId,
        @NotBlank(message = "name 不能为空") String name,
        String mode,
        String executor,
        String templateKey,
        Integer templateVersion,
        Map<String, Object> config) {

    public CreateJobRequest {
        config = config == null ? Map.of() : Map.copyOf(config);
    }
}
