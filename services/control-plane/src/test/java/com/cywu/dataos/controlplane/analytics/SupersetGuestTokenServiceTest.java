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
    private final AtomicReference<String> guestCsrf = new AtomicReference<>();
    private final AtomicReference<String> guestCookie = new AtomicReference<>();
    private final java.util.concurrent.atomic.AtomicInteger guestCalls = new java.util.concurrent.atomic.AtomicInteger();

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/security/login", exchange -> {
            loginBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            respond(exchange, "{\"access_token\":\"admin-jwt\"}");
        });
        server.createContext("/api/v1/security/csrf_token/", exchange -> {
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.getResponseHeaders().add("Set-Cookie", "session=session-cookie-value; Path=/; HttpOnly");
            var bytes = "{\"result\":\"csrf-token-value\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (var output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        });
        server.createContext("/api/v1/security/guest_token/", exchange -> {
            guestCalls.incrementAndGet();
            guestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            guestAuth.set(exchange.getRequestHeaders().getFirst("Authorization"));
            guestCsrf.set(exchange.getRequestHeaders().getFirst("X-CSRFToken"));
            guestCookie.set(exchange.getRequestHeaders().getFirst("Cookie"));
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
        var token = service.issue("2", "zhang.san");

        assertThat(token.token()).isEqualTo("guest-token-xyz");
        assertThat(token.dashboardId()).isEqualTo("2");
        assertThat(token.expiresInSeconds()).isEqualTo(300);
        assertThat(guestAuth.get()).isEqualTo("Bearer admin-jwt");
        assertThat(guestCsrf.get()).isEqualTo("csrf-token-value");
        assertThat(guestCookie.get()).contains("session=session-cookie-value");
        assertThat(loginBody.get()).contains("dataos-spike").contains("spike-secret");
        assertThat(guestBody.get()).contains("\"role\":\"Viewer\"");
        assertThat(guestBody.get()).contains("\"id\":\"2\"");
        assertThat(guestBody.get()).contains("portal-zhang.san").contains("\"rls\":[]");
    }

    @Test
    void cachesAdminTokenAcrossGuestTokenCalls() {
        service.issue("2", "zhang.san");
        service.issue("2", "zhang.san");

        assertThat(loginBody.get()).isNotNull();
    }

    @Test
    void rejectsDashboardOutsideWhitelist() {
        assertThatThrownBy(() -> service.issue("9", "zhang.san"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("白名单");
        assertThat(loginBody.get()).isNull();
    }

    @Test
    void cachesGuestTokenPerUserAndDashboard() {
        // S4：同用户同仪表盘命中缓存（只打一次 Superset）；换用户重新签发
        service.issue("2", "zhang.san");
        service.issue("2", "zhang.san");
        assertThat(guestCalls.get()).isEqualTo(1);
        service.issue("2", "li.si");
        assertThat(guestCalls.get()).isEqualTo(2);
        assertThat(guestBody.get()).contains("portal-li.si");
    }

    @Test
    void portalUsernameIsNamespacedAndSanitized() {
        assertThat(SupersetGuestTokenService.portalUsername("admin")).isEqualTo("portal-admin");
        assertThat(SupersetGuestTokenService.portalUsername("张三")).isEqualTo("portal-__");
        assertThat(SupersetGuestTokenService.portalUsername(null)).isEqualTo("portal-guest");
        assertThat(SupersetGuestTokenService.portalUsername("  ")).isEqualTo("portal-guest");
    }

    @Test
    void unreachableSupersetMapsToAdapterUnavailable() {
        var properties = new AnalyticsProperties();
        properties.setBaseUrl("http://127.0.0.1:1");
        properties.setAllowedDashboards(List.of("2"));
        var offline = new SupersetGuestTokenService(RestClient.builder(), properties);

        assertThatThrownBy(() -> offline.issue("2", "zhang.san")).isInstanceOf(AdapterUnavailableException.class);
    }
}
