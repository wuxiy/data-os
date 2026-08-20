package com.cywu.dataos.controlplane.analytics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class SupersetGuestTokenServiceTest {

    private HttpServer server;
    private SupersetGuestTokenService service;
    private final AtomicReference<String> loginBody = new AtomicReference<>();
    private final AtomicReference<String> guestBody = new AtomicReference<>();
    private final AtomicReference<String> guestAuth = new AtomicReference<>();

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/security/login", exchange -> {
            loginBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, "{\"access_token\":\"admin-jwt\"}");
        });
        server.createContext("/api/v1/security/guest_token/", exchange -> {
            guestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            guestAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            respond(exchange, "{\"token\":\"guest-token-xyz\"}");
        });
        server.start();
        var properties = new AnalyticsProperties();
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.setUsername("dataos-spike");
        properties.setPassword("spike-secret");
        properties.setAllowedDashboards(List.of("2"));
        service = new SupersetGuestTokenService(RestClient.builder(), properties);
    }

    @AfterEach
    void stopStub() {
        server.stop(0);
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String body) throws IOException {
        var bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    @Test
    void issuesGuestTokenForWhitelistedDashboard() {
        var token = service.issue("2");

        assertThat(token.token()).isEqualTo("guest-token-xyz");
        assertThat(token.dashboardId()).isEqualTo("2");
        assertThat(token.expiresInSeconds()).isEqualTo(300);
        assertThat(guestAuth.get()).isEqualTo("Bearer admin-jwt");
        assertThat(loginBody.get()).contains("dataos-spike").contains("spike-secret");
        assertThat(guestBody.get()).contains("\"role\":\"Viewer\"");
        assertThat(guestBody.get()).contains("\"id\":\"2\"");
        assertThat(guestBody.get()).contains("portal-guest");
    }

    @Test
    void cachesAdminTokenAcrossGuestTokenCalls() {
        service.issue("2");
        service.issue("2");

        assertThat(loginBody.get()).isNotNull();
    }

    @Test
    void rejectsDashboardOutsideWhitelist() {
        assertThatThrownBy(() -> service.issue("9"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("白名单");
        assertThat(loginBody.get()).isNull();
    }

    @Test
    void unreachableSupersetMapsToAdapterUnavailable() {
        var properties = new AnalyticsProperties();
        properties.setBaseUrl("http://127.0.0.1:1");
        properties.setAllowedDashboards(List.of("2"));
        var offline = new SupersetGuestTokenService(RestClient.builder(), properties);

        assertThatThrownBy(() -> offline.issue("2")).isInstanceOf(AdapterUnavailableException.class);
    }
}
