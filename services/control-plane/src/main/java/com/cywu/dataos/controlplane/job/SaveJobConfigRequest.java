package com.cywu.dataos.controlplane.job;

import java.util.Map;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/**
 * 保存任务配置的请求。structured 为结构化任务意图（表单形态）：存在时由服务端
 * 编译产出 config（config 字段可省略，空值校验在服务内）；为空时按既有路径
 * 保存 JSON 配置并清空已存的结构化意图。
 */
public record SaveJobConfigRequest(
        @NotBlank(message = "templateKey 不能为空") String templateKey,
        @Min(value = 1, message = "templateVersion 必须大于 0") Integer templateVersion,
        Map<String, Object> config,
        Map<String, Object> structured) {

    public SaveJobConfigRequest {
        templateVersion = templateVersion == null ? 1 : templateVersion;
        config = config == null ? Map.of() : Map.copyOf(config);
        structured = structured == null ? null : Map.copyOf(structured);
    }

    /** 既有 JSON 配置保存路径（含 JobService.create 内部调用点）三参形态。 */
    public SaveJobConfigRequest(String templateKey, Integer templateVersion, Map<String, Object> config) {
        this(templateKey, templateVersion, config, null);
    }
}
