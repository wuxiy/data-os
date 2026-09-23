package com.cywu.dataos.controlplane.assistant;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 问数执行客户端传输面（G26 dev 实测返程）：请求体必须以 application/json
 * 发出、Bearer 注入、URI 模板展开正确（曾因消息转换器协同问题被 FastAPI
 * 判 missing body，422）。
 */
class AssistantDataApiClientTest {

    private HttpServer server;
    private final ConcurrentLinkedQueue<String> bodies = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<String> contentTypes = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<String> authorizations = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<String> paths = new ConcurrentLinkedQueue<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal", exchange -> {
            capture(exchange);
            respond(exchange, 200, """
                    {"service":"prescription-daily-summary","version":"v1",
                     "columns":["stat_date"],"rows":[["2026-09-01"]],
                     "rowCount":1,"truncated":false,"elapsedMs":3}
                    """);
        });
        server.createContext("/token", exchange -> {
            System.out.println("TOKEN-HIT");
            try {
                capture(exchange);
                respond(exchange, 200, "{\"access_token\":\"stub-token\",\"expires_in\":300}");
                System.out.println("TOKEN-OK");
            } catch (Throwable e) {
                System.out.println("TOKEN-HANDLER-THREW: " + e); java.util.Arrays.stream(e.getStackTrace()).limit(4).forEach(f -> System.out.println("  at " + f));
            }
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void capture(HttpExchange exchange) throws IOException {
        paths.add(exchange.getRequestURI().getPath());
        contentTypes.add(String.valueOf(exchange.getRequestHeaders().getFirst("Content-Type")));
        authorizations.add(String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")));
        bodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    @Test
    void postsJsonBodyWithBearerTokenAndTemplateUri() {
        var base = "http://127.0.0.1:" + server.getAddress().getPort();
        var client = new AssistantDataApiClient(RestClient.builder(),
                base, base + "/token", "client", "secret", "");
        var result = client.query("prescription-daily-summary",
                Map.of("start_date", "2026-09-01", "end_date", "2026-09-07"));
        assertThat(result.serviceCode()).isEqualTo("prescription-daily-summary");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.serviceVersion()).isEqualTo("v1");
        assertThat(paths).last().isEqualTo("/internal/v1/verified-queries/prescription-daily-summary/query");
        assertThat(contentTypes).last().asString().contains("application/json");
        assertThat(bodies).last().asString().contains("\"start_date\"");
        assertThat(authorizations).last().isEqualTo("Bearer stub-token");
    }

    @Test
    void notFoundMapsToServiceOfflineAndUnconfiguredRefuses() {
        var base = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/internal/v1/verified-queries/missing/query", exchange -> {
            capture(exchange);
            respond(exchange, 404, "{\"detail\":{\"code\":\"SERVICE_NOT_PUBLISHED\","
                    + "\"message\":\"服务已下线（DEPRECATED）: missing\"}}");
        });
        var client = new AssistantDataApiClient(RestClient.builder(),
                base, base + "/token", "client", "secret", "");
        var thrown = org.assertj.core.api.Assertions.catchThrowable(
                () -> client.query("missing", Map.of()));
        assertThat(thrown).isInstanceOf(AssistantDataApiClient.QueryRejected.class);
        assertThat(((AssistantDataApiClient.QueryRejected) thrown).kind).isEqualTo("SERVICE_OFFLINE");
        // G27 粒度修正：404 体 message 透出（区分已下线与不存在），不再笼统覆盖
        assertThat(thrown.getMessage()).contains("服务已下线（DEPRECATED）");

        var unconfigured = new AssistantDataApiClient(RestClient.builder(), "", "", "", "", "");
        assertThat(unconfigured.configured()).isFalse();
    }
}
