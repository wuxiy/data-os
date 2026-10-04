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
        String artifactUri,
        Double score,
        Long totalRows,
        Long dirtyRows) {

    public QualityResultPayload {
        sampleEvidence = sampleEvidence == null ? List.of() : List.copyOf(sampleEvidence);
    }

    /** 既有四参形态（不带评分）。 */
    public QualityResultPayload(Boolean passed, String executionBatchId,
                                List<Map<String, Object>> sampleEvidence, String artifactUri) {
        this(passed, executionBatchId, sampleEvidence, artifactUri, null, null, null);
    }
}
