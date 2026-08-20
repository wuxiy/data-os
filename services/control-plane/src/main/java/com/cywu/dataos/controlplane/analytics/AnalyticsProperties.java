package com.cywu.dataos.controlplane.analytics;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.List;

/**
 * 嵌入式分析（Superset）访客令牌链配置。baseUrl 未配置时整链不装配，
 * 端点返回 503（与血缘链同一降级语义）。
 */
@ConfigurationProperties(prefix = "data-os.analytics.superset")
public class AnalyticsProperties {

    /** Superset API 根（容器网络内地址，如 http://superset:8088）。 */
    private String baseUrl = "";

    /** 签发访客令牌用的 Superset 账号（只用于换取 guest token，不下发）。 */
    private String username = "";
    private String password = "";

    /** 访客角色（固定只读语义，不给设计器权限）。 */
    private String guestRole = "Viewer";

    /** 访客令牌时效（秒）：短时效限制泄露面。 */
    private int guestTokenTtlSeconds = 300;

    /** 允许嵌入的仪表盘 id 白名单；白名单外一律 404。 */
    private List<String> allowedDashboards = List.of();

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username == null ? "" : username.trim();
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password == null ? "" : password.trim();
    }

    public String getGuestRole() {
        return guestRole;
    }

    public void setGuestRole(String guestRole) {
        this.guestRole = guestRole == null ? "Viewer" : guestRole.trim();
    }

    public int getGuestTokenTtlSeconds() {
        return guestTokenTtlSeconds;
    }

    public void setGuestTokenTtlSeconds(int guestTokenTtlSeconds) {
        this.guestTokenTtlSeconds = guestTokenTtlSeconds;
    }

    public List<String> getAllowedDashboards() {
        return allowedDashboards;
    }

    public void setAllowedDashboards(List<String> allowedDashboards) {
        this.allowedDashboards = allowedDashboards == null ? List.of() : allowedDashboards;
    }

    boolean allowsDashboard(String dashboardId) {
        return dashboardId != null && allowedDashboards.stream()
                .anyMatch(allowed -> allowed.trim().equals(dashboardId.trim()));
    }
}
