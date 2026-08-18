package com.cywu.dataos.controlplane.job;

import java.util.Map;

/**
 * 采集运行的提交命令：随领取事务产生，携带任务与已插值配置。
 */
public record IngestionSubmission(IngestionJob job, Map<String, Object> config) {
}
