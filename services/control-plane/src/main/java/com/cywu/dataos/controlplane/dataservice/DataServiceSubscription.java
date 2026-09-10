package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;

/**
 * 调用方合同变更订阅（P8 余项）：绑定到 API Key（归属 = 创建 Key）。
 * webhook_secret 是外发签名素材（HMAC-SHA256），存明文——与 API Key
 * 不同，它不用于鉴别来援请求，泄漏面仅限伪造我方通知。
 */
public record DataServiceSubscription(
        String id,
        String serviceId,
        String tenantId,
        String keyId,
        String keyHash,
        String callerName,
        String webhookUrl,
        String webhookSecret,
        SubscriptionStatus status,
        Instant createdAt,
        Instant revokedAt) {

    public enum SubscriptionStatus {
        ACTIVE, REVOKED
    }
}
