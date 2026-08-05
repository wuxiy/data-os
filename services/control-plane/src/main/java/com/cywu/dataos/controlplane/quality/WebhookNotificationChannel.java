package com.cywu.dataos.controlplane.quality;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;

import com.cywu.dataos.controlplane.governance.GovernanceNotification;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class WebhookNotificationChannel implements NotificationChannel {

    private final RestClient restClient;
    private final String webhookUrl;

    public WebhookNotificationChannel(RestClient.Builder builder,
                                      @Value("${data-os.notification.webhook-url:}") String webhookUrl) {
        var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(client);
        requestFactory.setReadTimeout(Duration.ofSeconds(10));
        this.restClient = builder.requestFactory(requestFactory).build();
        this.webhookUrl = webhookUrl == null ? "" : webhookUrl.trim();
    }

    @Override
    public boolean supports(String channel) {
        return "WEBHOOK".equalsIgnoreCase(channel);
    }

    @Override
    public NotificationDeliveryResult send(GovernanceNotification notification) {
        if (webhookUrl.isBlank()) {
            return new NotificationDeliveryResult("SKIPPED", "责任人 Webhook 未配置");
        }
        try {
            restClient.post()
                    .uri(webhookUrl)
                    .contentType(MediaType.APPLICATION_JSON)
                    .header("X-Data-OS-Notification-Key", notification.idempotencyKey())
                    .body(Map.of(
                            "notificationId", notification.id(),
                            "issueId", notification.issueId(),
                            "eventId", notification.eventId() == null ? "" : notification.eventId(),
                            "recipient", notification.recipient(),
                            "subject", notification.subject(),
                            "body", notification.body(),
                            "idempotencyKey", notification.idempotencyKey()))
                    .retrieve()
                    .toBodilessEntity();
            return new NotificationDeliveryResult("SENT", "责任人 Webhook 已送达");
        } catch (RestClientException exception) {
            return new NotificationDeliveryResult("FAILED", safeMessage(exception));
        }
    }

    private String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) return "责任人 Webhook 投递失败";
        return message.length() > 240 ? message.substring(0, 240) : message;
    }
}
