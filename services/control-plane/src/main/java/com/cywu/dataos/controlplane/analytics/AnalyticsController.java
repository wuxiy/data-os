package com.cywu.dataos.controlplane.analytics;

import java.util.Map;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 嵌入式分析 API：为门户分析页签发 Superset 访客令牌（guest token）与
 * 可嵌入仪表盘清单。令牌是浏览器侧短时效凭证（Viewer、限白名单仪表盘）；
 * 管理员凭据不出本服务。
 */
@RestController
@RequestMapping("/api/v1/analytics")
public class AnalyticsController {

    private final ObjectProvider<SupersetGuestTokenService> service;

    public AnalyticsController(ObjectProvider<SupersetGuestTokenService> service) {
        this.service = service;
    }

    @GetMapping("/dashboards")
    public ResponseEntity<?> dashboards() {
        var target = service.getIfAvailable();
        if (target == null) {
            return unavailable();
        }
        try {
            return ResponseEntity.ok(Map.of("dashboards", target.listDashboards()));
        } catch (AdapterUnavailableException exception) {
            return supersetUnavailable(exception);
        }
    }

    private ResponseEntity<?> unavailable() {
        return ResponseEntity.status(503).body(Map.of(
                "code", 503,
                "message", "分析服务未配置：请在控制面设置 data-os.analytics.superset.base-url 后重启"));
    }

    @PostMapping("/guest-token")
    public ResponseEntity<?> guestToken(@RequestBody Map<String, String> request) {
        var target = service.getIfAvailable();
        if (target == null) {
            return unavailable();
        }
        var dashboardId = request.getOrDefault("dashboardId", "");
        try {
            var token = target.issue(dashboardId);
            return ResponseEntity.ok(Map.of(
                    "token", token.token(),
                    "dashboardId", token.dashboardId(),
                    "expiresInSeconds", token.expiresInSeconds()));
        } catch (AdapterUnavailableException exception) {
            return supersetUnavailable(exception);
        } catch (IllegalStateException exception) {
            return ResponseEntity.status(404).body(Map.of("code", 404, "message", exception.getMessage()));
        }
    }

    private ResponseEntity<?> supersetUnavailable(AdapterUnavailableException exception) {
        return ResponseEntity.status(503).body(Map.of(
                "code", 503,
                "message", "Superset 暂时不可用：" + exception.getMessage()));
    }
}
