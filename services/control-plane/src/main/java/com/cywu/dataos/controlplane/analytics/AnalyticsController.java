package com.cywu.dataos.controlplane.analytics;

import java.util.Map;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 嵌入式分析 API：为门户分析页签发 Superset 访客令牌（guest token）与
 * 可嵌入仪表盘清单。降级（未配置/不可达）经中央异常出口返回 503
 * ProblemDetail；管理员凭据不出本服务。
 */
@RestController
@RequestMapping("/api/v1/analytics")
public class AnalyticsController {

    private final ObjectProvider<SupersetGuestTokenService> service;

    public AnalyticsController(ObjectProvider<SupersetGuestTokenService> service) {
        this.service = service;
    }

    @GetMapping("/dashboards")
    public Map<String, Object> dashboards() {
        return Map.of("dashboards", requireService().listDashboards());
    }

    @PostMapping("/guest-token")
    public Map<String, Object> guestToken(@RequestBody Map<String, String> request) {
        var dashboardId = request.getOrDefault("dashboardId", "");
        var token = requireService().issue(dashboardId);
        return Map.of(
                "token", token.token(),
                "dashboardId", token.dashboardId(),
                "expiresInSeconds", token.expiresInSeconds());
    }

    private SupersetGuestTokenService requireService() {
        var target = service.getIfAvailable();
        if (target == null) {
            throw new AdapterUnavailableException(
                    "分析服务未配置：请在控制面设置 data-os.analytics.superset.base-url 后重启");
        }
        return target;
    }
}
