package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.Map;

/** 任务配置读取面：编译产物 config + 结构化意图 structured（JSON 保存路径下为 null）。 */
public record IngestionJobConfig(
        String jobId,
        String templateKey,
        int templateVersion,
        Map<String, Object> config,
        Instant updatedAt,
        Map<String, Object> structured) {

    public IngestionJobConfig(String jobId, String templateKey, int templateVersion,
                              Map<String, Object> config, Instant updatedAt) {
        this(jobId, templateKey, templateVersion, config, updatedAt, null);
    }
}
