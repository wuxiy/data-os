package com.cywu.dataos.controlplane.run;

/**
 * 执行器接受一次提交后的回执：外部系统里的运行编号与说明。
 */
public record ExternalSubmission(String externalId, String message) {
}
