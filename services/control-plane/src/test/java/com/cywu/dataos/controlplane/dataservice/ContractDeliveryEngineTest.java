package com.cywu.dataos.controlplane.dataservice;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 合同投递引擎（P8 余项）：HMAC 签名外发（与治理通知同形态头）、
 * DELIVERED 终态、失败退避与超限 SKIPPED 留痕。
 */
@SpringBootTest
@ActiveProfiles("test")
class ContractDeliveryEngineTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SECRET = "test-contract-webhook-secret-0123456789abcdef";

    @Autowired
    private DataApiAdminService adminService;

    @Autowired
    private ContractNotificationRepository contracts;

    @Autowired
    private JdbcTemplate jdbc;

    private HttpServer server;
    private int port;
    private final List<Map<String, String>> received = new CopyOnWriteArrayList<>();
    private final List<String> bodies = new CopyOnWriteArrayList<>();
    private volatile boolean failMode = false;

    @BeforeEach
    void startReceiver() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        port = server.getAddress().getPort();
        server.createContext("/notify", exchange -> {
            var body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            if (failMode) {
                exchange.sendResponseHeaders(500, -1);
                return;
            }
            received.add(Map.of(
                    "timestamp", String.valueOf(exchange.getRequestHeaders().getFirst("X-Data-OS-Notification-Timestamp")),
                    "nonce", String.valueOf(exchange.getRequestHeaders().getFirst("X-Data-OS-Notification-Nonce")),
                    "signature", String.valueOf(exchange.getRequestHeaders().getFirst("X-Data-OS-Notification-Signature")),
                    "idempotencyKey", String.valueOf(exchange.getRequestHeaders().getFirst("Idempotency-Key"))));
            bodies.add(body);
            var response = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(response);
            }
        });
        server.start();
    }

    @AfterEach
    void stopReceiver() {
        server.stop(0);
    }

    private ContractNotificationService engine(long maxAttempts) {
        return new ContractNotificationService(contracts, RestClient.builder(), JSON,
                new ContractWebhookEndpointPolicy(true, true), maxAttempts, 60_000);
    }

    private String publishedServiceWithSubscription() {
        var code = "dlv-" + UUID.randomUUID().toString().substring(0, 8);
        var request = new CreateDataServiceRequest(
                code, "投递验证", "测试",
                "SELECT 1 AS x FROM ods_ep.ep_mz_cfzb WHERE cf_date BETWEEN :start_date AND :end_date",
                List.of(new CreateDataServiceRequest.ParameterContract("start_date", "date", true, "开始", null, null),
                        new CreateDataServiceRequest.ParameterContract("end_date", "date", true, "结束", null, null)),
                List.of(), 100, 30, "data-team");
        var definition = adminService.create(null, request);
        adminService.publish(definition.id(), null);
        var issued = adminService.issueKey(definition.id(), null, "投递验证方", List.of("*"), 100);
        // 测试无幂等回调：直接注入 hash（keyHash 已知）
        adminService.createSubscription(keyHash(issued.apiKey()),
                "http://127.0.0.1:" + port + "/notify", SECRET);
        return definition.id();
    }

    private String keyHash(String apiKey) {
        return DataApiAdminService.sha256Hex(apiKey);
    }

    @Test
    void deliversSignedPayloadAndMarksDelivered() throws Exception {
        var setup = publishedServiceWithSubscription();
        // 触发 UPDATED 事件（PUBLISHED 事件在订阅创建前，不参与本次断言）
        adminService.update(setup, null, new UpdateDataServiceRequest(
                null, "新描述-投递验证", null, null, null, null, null));

        var summary = engine(5).deliverPending();
        assertThat(summary.delivered()).isGreaterThanOrEqualTo(1);
        assertThat(received).isNotEmpty();

        var headers = received.get(received.size() - 1);
        var body = bodies.get(bodies.size() - 1);
        // 验签：canonical = timestamp.nonce.payload，HMAC-SHA256(secret)，v1=base64url
        var mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        var canonical = headers.get("timestamp") + "." + headers.get("nonce") + "." + body;
        var expected = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
        assertThat(headers.get("signature")).isEqualTo("v1=" + expected);

        JsonNode payload = JSON.readTree(body);
        assertThat(payload.get("changeType").asText()).isEqualTo("UPDATED");
        assertThat(payload.get("diff").get("description").get("to").asText()).isEqualTo("新描述-投递验证");
        assertThat(payload.has("eventId")).isTrue();
        assertThat(payload.has("idempotencyKey")).isTrue();

        // 交付行终态 DELIVERED
        var subscription = contracts.findActiveSubscriptions(setup).get(0);
        var deliveries = contracts.findDeliveriesBySubscription(subscription.id(), 10);
        assertThat(deliveries).anyMatch(item -> item.status() == DataServiceDelivery.DeliveryStatus.DELIVERED);
    }

    @Test
    void retriesThenSkipsAfterMaxAttempts() {
        failMode = true;
        var setup = publishedServiceWithSubscription();
        adminService.update(setup, null, new UpdateDataServiceRequest(
                null, "失败路径-投递验证", null, null, null, null, null));
        var engine = engine(2);

        var first = engine.deliverPending(); // attempt 1 → FAILED 退避
        assertThat(first.failed()).isGreaterThanOrEqualTo(1);
        var subscription = contracts.findActiveSubscriptions(setup).get(0);
        var deliveries = contracts.findDeliveriesBySubscription(subscription.id(), 10);
        var failed = deliveries.stream()
                .filter(item -> item.status() == DataServiceDelivery.DeliveryStatus.FAILED).findFirst().orElseThrow();
        assertThat(failed.lastError()).isNotBlank();

        // 拨过退避窗口再投 → attempt 2 达限 SKIPPED（留痕不删行）
        jdbc.update("UPDATE data_os.data_service_delivery SET next_attempt_at = ? WHERE id = ?",
                java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(3600)), failed.id());
        var second = engine.deliverPending();
        assertThat(second.skipped()).isGreaterThanOrEqualTo(1);
        deliveries = contracts.findDeliveriesBySubscription(subscription.id(), 10);
        assertThat(deliveries).anyMatch(item -> item.status() == DataServiceDelivery.DeliveryStatus.SKIPPED
                && item.lastError() != null && item.lastError().contains("最大重试"));
    }
}
