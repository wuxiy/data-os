package com.cywu.dataos.controlplane.quality;

import java.util.List;
import java.util.Map;

/**
 * 质量侧状态结果的业务载荷：随状态回写在同一条件更新中落库，
 * 生命周期模块不感知其内容。
 */
public record QualityResultPayload(
        Boolean passed,
        String executionBatchId,
        List<Map<String, Object>> sampleEvidence,
        String artifactUri) {

    public QualityResultPayload {
        sampleEvidence = sampleEvidence == null ? List.of() : List.copyOf(sampleEvidence);
    }
}
