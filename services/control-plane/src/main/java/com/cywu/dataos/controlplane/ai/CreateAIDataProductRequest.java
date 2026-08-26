package com.cywu.dataos.controlplane.ai;

import jakarta.validation.constraints.NotBlank;

/**
 * 创建 AI Data Product 的请求体（G8 计划 §三）。type/workflow 为词汇字符串，
 * 由服务层解析为 enum（非法值统一 400，错误格式与既有 API 一致）。
 */
public record CreateAIDataProductRequest(
        @NotBlank(message = "name 不能为空") String name,
        @NotBlank(message = "type 不能为空") String type,
        @NotBlank(message = "owner 不能为空") String owner,
        @NotBlank(message = "workflow 不能为空") String workflow,
        @NotBlank(message = "source 不能为空") String source) {
}
