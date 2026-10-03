package com.cywu.dataos.controlplane.source;

import java.time.Instant;
import java.util.Map;

public record Source(
        String id,
        String tenantId,
        String institutionId,
        String name,
        String systemType,
        String protocol,
        String status,
        Instant createdAt,
        Instant lastCheckedAt,
        String lastCheckMessage,
        Map<String, Object> connection) {

    /** 既有构造点（检查适配器测试等）不感知连接配置；浏览链路显式传第十一参。 */
    public Source(
            String id,
            String tenantId,
            String institutionId,
            String name,
            String systemType,
            String protocol,
            String status,
            Instant createdAt,
            Instant lastCheckedAt,
            String lastCheckMessage) {
        this(id, tenantId, institutionId, name, systemType, protocol, status,
                createdAt, lastCheckedAt, lastCheckMessage, null);
    }
}
