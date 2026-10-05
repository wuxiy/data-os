package com.cywu.dataos.controlplane.operations;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ConcurrentLinkedQueue;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * MPI 指标客户端传输面（G2G B 组）：凭据配置时注入 Bearer（token 端点真实
 * 被调）；凭据空时不发 Authorization 头——DISABLED 直连口径行为保持。
 */
class HttpMpiFactsClientTest {

    private HttpServer server;
    private final ConcurrentLinkedQueue<String> authorizations = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<String> paths = new ConcurrentLinkedQueue<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/mpi/metrics", exchange -> {
            capture(exchange);
            respond(exchange, 200, "{\"reviewPending\":7}");
        });
        server.createContext("/token", exchange -> {
            capture(exchange);
            respond(exchange, 200, "{\"access_token\":\"stub-token\",\"expires_in\":300}");
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void capture(HttpExchange exchange) throws IOException {
        paths.add(exchange.getRequestURI().getPath());
        authorizations.add(String.valueOf(exchange.getRequestHeaders().getFirst("Authorization")));
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
    void sendsBearerWhenCredentialsConfigured() {
        var base = "http://127.0.0.1:" + server.getAddress().getPort();
        var client = new HttpMpiFactsClient(RestClient.builder(), base,
                base + "/token", "dataos-control-plane-mpi", "secret", "data-os-mpi");
        assertThat(client.reviewPending()).isEqualTo(7L);
        assertThat(paths).first().isEqualTo("/token");
        assertThat(paths).last().isEqualTo("/api/v1/mpi/metrics");
        assertThat(authorizations).last().isEqualTo("Bearer stub-token");
    }

    @Test
    void keepsAnonymousDirectAccessWhenUnconfigured() {
        var base = "http://127.0.0.1:" + server.getAddress().getPort();
        var client = new HttpMpiFactsClient(RestClient.builder(), base);
        assertThat(client.reviewPending()).isEqualTo(7L);
        assertThat(authorizations).last().isEqualTo("null");
    }
}
