package com.cywu.dataos.controlplane.analytics;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.DefaultUriBuilderFactory;

/**
 * Superset 访客令牌签发：管理员登录（短缓存）→ guest_token（Viewer、限仪表盘、
 * 短时效）。管理员凭据与 access token 永不离开本服务；浏览器只拿到 guest token。
 */
public class SupersetGuestTokenService {

    private record AdminToken(String value, Instant expiresAt) {
    }

    private final RestClient restClient;
    private final AnalyticsProperties properties;
    private final AtomicReference<AdminToken> cachedAdmin = new AtomicReference<>();

    public SupersetGuestTokenService(RestClient.Builder builder, AnalyticsProperties properties) {
        var factory = new DefaultUriBuilderFactory(properties.getBaseUrl());
        factory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.NONE);
        this.restClient = builder.uriBuilderFactory(factory).build();
        this.properties = properties;
    }

    /** 为白名单内仪表盘签发访客令牌。白名单外或不可达分别抛 404/503 语义异常。 */
    public GuestToken issue(String dashboardId) {
        if (!properties.allowsDashboard(dashboardId)) {
            throw new IllegalStateException("仪表盘不在嵌入白名单内：" + dashboardId);
        }
        var token = post("/api/v1/security/guest_token/", Map.of(
                "user", Map.of(
                        "username", "portal-guest",
                        "first_name", "Portal",
                        "last_name", "Guest"),
                "role", properties.getGuestRole(),
                "resources", List.of(Map.of("type", "dashboard", "id", dashboardId)),
                "rls_rules", List.of()),
                adminToken());
        var value = String.valueOf(token.getOrDefault("token", ""));
        if (value.isBlank()) {
            throw new AdapterUnavailableException("Superset 访客令牌响应缺少 token");
        }
        return new GuestToken(value, dashboardId, properties.getGuestTokenTtlSeconds());
    }

    private String adminToken() {
        var existing = cachedAdmin.get();
        if (existing != null && existing.expiresAt().isAfter(Instant.now().plusSeconds(30))) {
            return existing.value();
        }
        synchronized (this) {
            existing = cachedAdmin.get();
            if (existing != null && existing.expiresAt().isAfter(Instant.now().plusSeconds(30))) {
                return existing.value();
            }
            var response = post("/api/v1/security/login", Map.of(
                    "username", properties.getUsername(),
                    "password", properties.getPassword(),
                    "provider", "db",
                    "refresh", true), null);
            var value = String.valueOf(response.getOrDefault("access_token", ""));
            if (value.isBlank()) {
                throw new AdapterUnavailableException("Superset 登录响应缺少 access_token");
            }
            cachedAdmin.set(new AdminToken(value, Instant.now().plusSeconds(600)));
            return value;
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> post(String path, Map<String, Object> body, String bearer) {
        try {
            var response = restClient.post()
                    .uri(path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .headers(headers -> {
                        if (bearer != null) headers.setBearerAuth(bearer);
                    })
                    .body(body)
                    .retrieve();
            Map<String, Object> parsed = response.body(Map.class);
            return parsed == null ? Map.of() : parsed;
        } catch (AdapterUnavailableException | IllegalStateException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            var cause = exception.getCause() == null ? exception : exception.getCause();
            throw new AdapterUnavailableException("Superset 暂时不可用：" + cause.getMessage());
        }
    }

    public record GuestToken(String token, String dashboardId, int expiresInSeconds) {
    }
}
