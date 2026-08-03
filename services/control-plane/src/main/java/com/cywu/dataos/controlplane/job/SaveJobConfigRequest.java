package com.cywu.dataos.controlplane.job;

import java.util.Map;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;

public record SaveJobConfigRequest(
        @NotBlank(message = "templateKey 不能为空") String templateKey,
        @Min(value = 1, message = "templateVersion 必须大于 0") Integer templateVersion,
        @NotEmpty(message = "config 不能为空") Map<String, Object> config) {

    public SaveJobConfigRequest {
        templateVersion = templateVersion == null ? 1 : templateVersion;
        config = config == null ? Map.of() : Map.copyOf(config);
    }
}
