package com.cywu.dataos.controlplane.quality;

import com.cywu.dataos.controlplane.api.ErrorMessages;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.Map;

import com.cywu.dataos.controlplane.executor.AdapterHttp;
import com.cywu.dataos.controlplane.governance.GovernanceNotification;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;

@Component
public class WebhookNotificationChannel implements NotificationChannel {

    private final RestClient restClient;
    private final String webhookUrl;
    private final WebhookSecretProvider secrets;
    private final NotificationEndpointPolicy endpointPolicy;
    private final ObjectMapper objectMapper;

    @Autowired
    public WebhookNotificationChannel(RestClient.Builder builder,
                                      @Value("${data-os.notification.webhook-url:}") String webhookUrl,
                                      @Value("${data-os.notification.webhook-secret:}") String webhookSecret,
                                      @Value("${data-os.notification.webhook-secret-file:}") String webhookSecretFile,
                                      ObjectMapper objectMapper,
                                      NotificationEndpointPolicy endpointPolicy) {
        this.restClient = AdapterHttp.restClient(builder, Duration.ofSeconds(3), Duration.ofSeconds(10));
        this.webhookUrl = webhookUrl == null ? "" : webhookUrl.trim();
        this.objectMapper = objectMapper;
        this.secrets = new WebhookSecretProvider(objectMapper, webhookSecret, webhookSecretFile);
        this.endpointPolicy = endpointPolicy;
    }

    /** Focused test constructor; production wiring always uses the signed-secret constructor above. */
    public WebhookNotificationChannel(RestClient.Builder builder, String webhookUrl) {
        this(builder, webhookUrl, "test-webhook-secret-0123456789012345", "", new ObjectMapper(),
                new NotificationEndpointPolicy(true, true, java.util.List.of("127.0.0.1", "localhost"), true));
    }

    @Override
    public boolean supports(String channel) {
        return "WEBHOOK".equalsIgnoreCase(channel);
    }

    @Override
    public boolean configured() {
        return !webhookUrl.isBlank() && secrets.current().length() >= 32;
    }

    @Override
    public String configurationProblem() {
        if (webhookUrl.isBlank()) return "责任人 Webhook 未配置，通知只会记录为 SKIPPED";
        var secret = secrets.current();
        if (secret.isBlank()) return "责任人 Webhook 签名密钥缺失，通知不会发送";
        if (secret.length() < 32) return "责任人 Webhook 签名密钥强度不足，通知不会发送";
        return "";
    }

    @Override
    public NotificationDeliveryResult send(GovernanceNotification notification) {
        if (webhookUrl.isBlank()) {
            return new NotificationDeliveryResult("SKIPPED", "责任人签名 Webhook 未配置");
        }
        var secret = secrets.current();
        if (secret.isBlank()) return new NotificationDeliveryResult("FAILED", "责任人 Webhook 签名密钥未配置");
        if (secret.length() < 32) {
            return new NotificationDeliveryResult("FAILED", "责任人 Webhook 签名密钥强度不足");
        }
        try {
            endpointPolicy.validate(webhookUrl);
        } catch (IllegalArgumentException exception) {
            return new NotificationDeliveryResult("FAILED", exception.getMessage());
        }
        try {
            var nonce = UUID.randomUUID().toString();
            var timestamp = String.valueOf(Instant.now().getEpochSecond());
            var payload = objectMapper.writeValueAsString(Map.of(
                    "tenantId", notification.tenantId(),
                    "institutionId", notification.institutionId(),
                    "recipientId", notification.recipientId(),
                    "issueId", notification.issueId(),
                    "eventId", notification.eventId() == null ? "" : notification.eventId(),
                    "subject", notification.subject(),
                    "message", notification.body(),
                    "idempotencyKey", notification.idempotencyKey()));
            var canonical = timestamp + "." + nonce + "." + payload;
            var signature = Base64.getUrlEncoder().withoutPadding().encodeToString(
                    hmac(secret)
                            .doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
            restClient.post()
                    .uri(webhookUrl)
                    .contentType(MediaType.APPLICATION_JSON)
                    .header("X-Data-OS-Notification-Timestamp", timestamp)
                    .header("X-Data-OS-Notification-Nonce", nonce)
                    .header("X-Data-OS-Notification-Signature", "v1=" + signature)
                    .header("Idempotency-Key", notification.idempotencyKey())
                    .body(payload)
                    .retrieve()
                    .toBodilessEntity();
            return new NotificationDeliveryResult("SENT", "责任人 Webhook 已送达");
        } catch (RestClientException | java.security.GeneralSecurityException | com.fasterxml.jackson.core.JsonProcessingException exception) {
            return new NotificationDeliveryResult("FAILED", ErrorMessages.safe(exception));
        }
    }

    private javax.crypto.Mac hmac(String secret) throws java.security.GeneralSecurityException {
        var mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return mac;
    }
}
