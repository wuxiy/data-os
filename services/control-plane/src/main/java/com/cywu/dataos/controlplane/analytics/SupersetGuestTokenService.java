package com.cywu.dataos.controlplane.analytics;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.DefaultUriBuilderFactory;

/**
 * Superset 访客令牌签发：管理员登录（短缓存）→ guest_token（Viewer、限仪表盘、
 * 短时效）。管理员凭据与 access token 永不离开本服务；浏览器只拿到 guest token。
 *
 * S4：签发按（用户 × 仪表盘）维度短缓存——同用户刷新页面不重复压 Superset；
 * 令牌用户名带 portal- 前缀（与 Superset 真实账号隔离，审计可区分门户用户）。
 */
public class SupersetGuestTokenService {

    private record AdminToken(String value, Instant expiresAt) {
    }

    private record CachedGuestToken(GuestToken token, Instant expiresAt) {
    }

    /** 缓存上限（白名单仪表盘 × 门户用户数的保守界；超限先清过期再整体让位）。 */
    private static final int MAX_CACHE_ENTRIES = 1000;

    /** 缓存命中窗口在令牌时效基础上预留的安全边际（秒）。 */
    private static final int CACHE_SAFETY_MARGIN_SECONDS = 30;

    private final RestClient restClient;
    private final AnalyticsProperties properties;
    private final AtomicReference<AdminToken> cachedAdmin = new AtomicReference<>();
    private final ConcurrentHashMap<String, CachedGuestToken> cachedGuestTokens = new ConcurrentHashMap<>();

    public SupersetGuestTokenService(RestClient.Builder builder, AnalyticsProperties properties) {
        var factory = new DefaultUriBuilderFactory(properties.getBaseUrl());
        factory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.NONE);
        this.restClient = builder.uriBuilderFactory(factory).build();
        this.properties = properties;
    }

    /** 为白名单内仪表盘签发访客令牌（按用户维度缓存）。白名单外或不可达分别抛 404/503 语义异常。 */
    public GuestToken issue(String dashboardId, String username) {
        if (!properties.allowsDashboard(dashboardId)) {
            throw new IllegalStateException("仪表盘不在嵌入白名单内：" + dashboardId);
        }
        var cacheKey = dashboardId.trim() + "\u0000" + portalUsername(username);
        var now = Instant.now();
        var cached = cachedGuestTokens.get(cacheKey);
        if (cached != null && cached.expiresAt().isAfter(now)) {
            return cached.token();
        }
        var value = post("/api/v1/security/guest_token/", Map.of(
                "user", Map.of(
                        "username", portalUsername(username),
                        "first_name", "Portal",
                        "last_name", "Guest"),
                "role", properties.getGuestRole(),
                "resources", List.of(Map.of("type", "dashboard", "id", dashboardId)),
                "rls", List.of()),
                adminToken(), csrfHeaders(adminToken()));
        var tokenValue = String.valueOf(value.getOrDefault("token", ""));
        if (tokenValue.isBlank()) {
            throw new AdapterUnavailableException("Superset 访客令牌响应缺少 token");
        }
        var token = new GuestToken(tokenValue, dashboardId, properties.getGuestTokenTtlSeconds());
        var ttl = Math.max(properties.getGuestTokenTtlSeconds() - CACHE_SAFETY_MARGIN_SECONDS, 0);
        if (cachedGuestTokens.size() >= MAX_CACHE_ENTRIES) {
            cachedGuestTokens.values().removeIf(entry -> !entry.expiresAt().isAfter(now));
            if (cachedGuestTokens.size() >= MAX_CACHE_ENTRIES) {
                cachedGuestTokens.clear();
            }
        }
        cachedGuestTokens.put(cacheKey, new CachedGuestToken(token, now.plusSeconds(ttl)));
        return token;
    }

    /**
     * 门户用户名 → Superset 访客用户名：portal- 前缀防与 Superset 真实账号
     * （如 admin）撞名提权；非法字符收敛为下划线，空身份回落共享访客。
     */
    static String portalUsername(String username) {
        var sanitized = (username == null ? "" : username).trim().replaceAll("[^A-Za-z0-9_.-]", "_");
        return sanitized.isBlank() ? "portal-guest" : "portal-" + sanitized;
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

    /**
     * Superset 写操作要求 flask-wtf 双提交 CSRF：GET csrf_token 取令牌，
     * 同名 cookie + X-CSRFToken 头成对携带（Referer 亦为校验项）。
     */
    private Map<String, String> csrfHeaders(String bearer) {
        try {
            var entity = restClient.get()
                    .uri("/api/v1/security/csrf_token/")
                    .accept(MediaType.APPLICATION_JSON)
                    .headers(headers -> headers.setBearerAuth(bearer))
                    .retrieve()
                    .toEntity(Map.class);
            var body = entity.getBody() == null ? Map.of() : entity.getBody();
            var token = String.valueOf(body.getOrDefault("result", ""));
            var cookie = entity.getHeaders().get("Set-Cookie").stream()
                    .filter(value -> value.startsWith("session="))
                    .map(value -> value.split(";", 2)[0])
                    .findFirst().orElse("");
            if (token.isBlank() || cookie.isBlank()) {
                throw new AdapterUnavailableException("Superset CSRF 令牌不完整");
            }
            return Map.of(
                    "X-CSRFToken", token,
                    "Cookie", cookie,
                    "Referer", properties.getBaseUrl() + "/");
        } catch (AdapterUnavailableException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            var cause = exception.getCause() == null ? exception : exception.getCause();
            throw new AdapterUnavailableException("Superset CSRF 获取失败：" + cause.getMessage());
        }
    }

    /** 白名单仪表盘清单（标题 + 嵌入 uuid），供门户目录渲染。 */
    public List<EmbeddableDashboard> listDashboards() {
        var token = adminToken();
        return properties.getAllowedDashboards().stream()
                .map(dashboardId -> {
                    var dashboard = resultOf(get("/api/v1/dashboard/" + dashboardId, token));
                    var embedded = get("/api/v1/dashboard/" + dashboardId + "/embedded", token);
                    Map<?, ?> embeddedResult = resultOf(embedded);
                    if (embedded.get("result") instanceof Map<?, ?> result) {
                        embeddedResult = result;
                    }
                    var titleValue = dashboard.get("dashboard_title");
                    var uuidValue = embeddedResult.get("uuid");
                    var title = titleValue == null || String.valueOf(titleValue).isBlank()
                            ? dashboardId.trim() : String.valueOf(titleValue);
                    var uuid = uuidValue == null ? "" : String.valueOf(uuidValue);
                    return new EmbeddableDashboard(dashboardId.trim(), title, uuid);
                })
                .toList();
    }

    /** Superset API 单体响应统一包在 result 字段内。 */
    private static Map<?, ?> resultOf(Map<String, Object> response) {
        return response.get("result") instanceof Map<?, ?> result ? result : Map.of();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> get(String path, String bearer) {
        try {
            var response = restClient.get()
                    .uri(path)
                    .accept(MediaType.APPLICATION_JSON)
                    .headers(headers -> headers.setBearerAuth(bearer))
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

    @SuppressWarnings("unchecked")
    private Map<String, Object> post(String path, Map<String, Object> body, String bearer) {
        return post(path, body, bearer, Map.of());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> post(String path, Map<String, Object> body, String bearer,
                                     Map<String, String> extraHeaders) {
        try {
            var response = restClient.post()
                    .uri(path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .headers(headers -> {
                        if (bearer != null) headers.setBearerAuth(bearer);
                        extraHeaders.forEach(headers::set);
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

    public record EmbeddableDashboard(String id, String title, String embeddedUuid) {
    }
}
