package com.cywu.dataos.controlplane.dataservice;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ErrorMessages;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 合同事件投递引擎（P8 余项）：发件箱租约 + HMAC 签名 webhook 外发。
 * 签名头与治理通知同形态（X-Data-OS-Notification-Timestamp/Nonce/
 * Signature/Idempotency-Key，canonical = timestamp.nonce.payload），
 * 调用方可用同一验签实现接两类通知；退避 30s·2^n 封顶 1h，
 * 超过 max-attempts 后 SKIPPED 留痕（不删行，运维可查）。
 */
@Service
public class ContractNotificationService {

    private final ContractNotificationRepository repository;
    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final ContractWebhookEndpointPolicy endpointPolicy;
    private final long maxAttempts;
    private final long leaseMs;
    private final String workerId = "contract-notify-" + UUID.randomUUID();

    public ContractNotificationService(ContractNotificationRepository repository,
                                       RestClient.Builder builder,
                                       ObjectMapper objectMapper,
                                       ContractWebhookEndpointPolicy endpointPolicy,
                                       @Value("${data-os.data-api.contract-notify-max-attempts:5}") long maxAttempts,
                                       @Value("${data-os.data-api.contract-notify-lease-ms:120000}") long leaseMs) {
        this.repository = repository;
        this.restClient = com.cywu.dataos.controlplane.executor.AdapterHttp.restClient(
                builder, Duration.ofSeconds(3), Duration.ofSeconds(10));
        this.objectMapper = objectMapper;
        this.endpointPolicy = endpointPolicy;
        this.maxAttempts = Math.max(1, maxAttempts);
        this.leaseMs = Math.max(5_000, leaseMs);
    }

    public record DeliverySummary(int processed, int delivered, int failed, int skipped) {
    }

    public DeliverySummary deliverPending() {
        var now = Instant.now();
        var claimed = repository.claimDueDeliveries(now, now.plusMillis(leaseMs), workerId);
        var delivered = 0;
        var failed = 0;
        var skipped = 0;
        for (var delivery : claimed) {
            switch (deliverOne(delivery)) {
                case "DELIVERED" -> delivered++;
                case "SKIPPED" -> skipped++;
                default -> failed++;
            }
        }
        return new DeliverySummary(claimed.size(), delivered, failed, skipped);
    }

    @Scheduled(
            fixedDelayString = "${data-os.data-api.contract-notify-interval-ms:30000}",
            initialDelayString = "${data-os.data-api.contract-notify-initial-delay-ms:10000}")
    public void scheduledDelivery() {
        deliverPending();
    }

    private String deliverOne(DataServiceDelivery delivery) {
        var event = repository.findEvent(delivery.eventId()).orElse(null);
        var subscription = repository.findSubscription(delivery.subscriptionId()).orElse(null);
        if (event == null || subscription == null
                || subscription.status() != DataServiceSubscription.SubscriptionStatus.ACTIVE) {
            repository.markDeliverySkipped(delivery.id(), workerId, "事件或订阅已失效", Instant.now());
            return "SKIPPED";
        }
        String failure;
        try {
            failure = postWebhook(event, subscription, delivery);
        } catch (RuntimeException exception) {
            failure = ErrorMessages.safe(exception);
        }
        var now = Instant.now();
        if (failure == null) {
            repository.markDeliveryDelivered(delivery.id(), workerId, now);
            return "DELIVERED";
        }
        if (delivery.attemptCount() + 1 >= maxAttempts) {
            repository.markDeliverySkipped(delivery.id(), workerId, "已达到最大重试次数：" + failure, now);
            return "SKIPPED";
        }
        var backoffSeconds = Math.min(3600, 30L * (1L << Math.min(6, delivery.attemptCount())));
        repository.markDeliveryFailed(delivery.id(), workerId, failure,
                now.plus(Duration.ofSeconds(backoffSeconds)), now);
        return "FAILED";
    }

    /** null = 送达；非 null = 失败原因（投递方异常或非 2xx）。 */
    private String postWebhook(DataServiceContractEvent event, DataServiceSubscription subscription,
                               DataServiceDelivery delivery) {
        try {
            endpointPolicy.validate(subscription.webhookUrl());
        } catch (IllegalArgumentException exception) {
            return exception.getMessage();
        }
        Map<String, Object> payloadMap = new LinkedHashMap<>();
        payloadMap.put("eventId", event.id());
        payloadMap.put("serviceCode", event.serviceCode());
        payloadMap.put("changeType", event.changeType());
        payloadMap.put("fromVersion", event.fromVersion());
        payloadMap.put("toVersion", event.toVersion());
        try {
            payloadMap.put("diff", event.diffJson() == null || event.diffJson().isBlank()
                    ? Map.of()
                    : objectMapper.readTree(event.diffJson()));
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            return "事件 diff 载荷损坏";
        }
        payloadMap.put("occurredAt", event.createdAt().toString());
        payloadMap.put("subscriptionId", subscription.id());
        payloadMap.put("idempotencyKey", delivery.idempotencyKey());
        final String payload;
        try {
            payload = objectMapper.writeValueAsString(payloadMap);
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            return "事件载荷序列化失败";
        }
        try {
            var nonce = UUID.randomUUID().toString();
            var timestamp = String.valueOf(Instant.now().getEpochSecond());
            var canonical = timestamp + "." + nonce + "." + payload;
            var signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
                    hmac(subscription.webhookSecret()).doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
            restClient.post()
                    .uri(subscription.webhookUrl())
                    .contentType(MediaType.APPLICATION_JSON)
                    .header("X-Data-OS-Notification-Timestamp", timestamp)
                    .header("X-Data-OS-Notification-Nonce", nonce)
                    .header("X-Data-OS-Notification-Signature", "v1=" + signature)
                    .header("Idempotency-Key", delivery.idempotencyKey())
                    .body(payload)
                    .retrieve()
                    .toBodilessEntity();
            return null;
        } catch (RestClientException | java.security.GeneralSecurityException exception) {
            return ErrorMessages.safe(exception);
        }
    }

    private javax.crypto.Mac hmac(String secret) throws java.security.GeneralSecurityException {
        var mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return mac;
    }
}
