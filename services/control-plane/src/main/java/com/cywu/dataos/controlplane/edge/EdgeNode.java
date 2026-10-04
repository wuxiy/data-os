package com.cywu.dataos.controlplane.edge;

import java.time.Instant;
import java.util.Map;

/** 前置机节点台账行（G2G 批次 4）。state 为读模型衍生，不落库。 */
public record EdgeNode(
        String id,
        String tenantId,
        String institutionId,
        String name,
        String groupName,
        String site,
        String host,
        int port,
        String version,
        Instant lastProbeAt,
        Boolean lastProbeOk,
        String lastProbeMessage,
        Map<String, Object> config,
        Instant createdAt,
        Instant updatedAt,
        String state) {

    /** ONLINE=最近探测成功；OFFLINE=最近探测失败；UNKNOWN=从未探测。 */
    public String derivedState() {
        if (lastProbeOk == null) return "UNKNOWN";
        return lastProbeOk ? "ONLINE" : "OFFLINE";
    }
}
