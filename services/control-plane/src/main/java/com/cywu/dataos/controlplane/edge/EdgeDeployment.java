package com.cywu.dataos.controlplane.edge;

import java.time.Instant;

/** 前置机发布记录（G2G 批次 4 第二刀）：版本登记面，不承载制品二进制。 */
public record EdgeDeployment(
        String id,
        String nodeId,
        String version,
        String artifactRef,
        String note,
        String deployedBy,
        Instant deployedAt) {
}
