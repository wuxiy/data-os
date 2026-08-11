package com.cywu.dataos.controlplane.quality;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.cywu.dataos.controlplane.governance.GovernanceNotification;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class WebhookNotificationChannelTest {

    @Test
    void signsResponsibilityPayloadWithTimestampAndNonce() throws Exception {
        var bodyRef = new AtomicReference<String>();
        var timestampRef = new AtomicReference<String>();
        var nonceRef = new AtomicReference<String>();
        var signatureRef = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/notify", exchange -> {
            bodyRef.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            timestampRef.set(exchange.getRequestHeaders().getFirst("X-Data-OS-Notification-Timestamp"));
            nonceRef.set(exchange.getRequestHeaders().getFirst("X-Data-OS-Notification-Nonce"));
            signatureRef.set(exchange.getRequestHeaders().getFirst("X-Data-OS-Notification-Signature"));
            exchange.sendResponseHeaders(202, -1);
            exchange.close();
        });
        server.start();
        try {
            var channel = new WebhookNotificationChannel(
                    RestClient.builder(), "http://127.0.0.1:" + server.getAddress().getPort() + "/notify");
            var result = channel.send(new GovernanceNotification(
                    "n1", "issue-1", "event-1", "tenant-a", "hospital-a", "WEBHOOK", "owner", "owner-1",
                    "subject", "message", "PENDING", "idem-1", 0, null, null, null, null, null, null, null));

            assertThat(result.status()).isEqualTo("SENT");
            assertThat(timestampRef).hasValueSatisfying(value -> assertThat(value).isNotBlank());
            assertThat(nonceRef).hasValueSatisfying(value -> assertThat(value).isNotBlank());
            assertThat(signatureRef).hasValueSatisfying(value -> assertThat(value).startsWith("v1="));
            var canonical = timestampRef.get() + "." + nonceRef.get() + "." + bodyRef.get();
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec("test-webhook-secret-0123456789012345".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            var expected = Base64.getUrlEncoder().withoutPadding().encodeToString(
                    mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
            assertThat(signatureRef.get()).isEqualTo("v1=" + expected);
        } finally {
            server.stop(0);
        }
    }
}
