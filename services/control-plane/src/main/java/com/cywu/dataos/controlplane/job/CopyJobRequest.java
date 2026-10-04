package com.cywu.dataos.controlplane.job;

/** 任务复制请求：目标源缺省为原源；名称缺省为「原名-副本」。 */
public record CopyJobRequest(String sourceId, String name) {
}
