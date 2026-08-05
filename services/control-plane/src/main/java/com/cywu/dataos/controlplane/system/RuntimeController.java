package com.cywu.dataos.controlplane.system;

import java.util.ArrayList;
import java.util.Locale;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system")
public class RuntimeController {

    private final boolean seedDemoEnabled;
    private final String qualityExecutor;
    private final String qualityExecutorBaseUrl;
    private final boolean demoQualityExecutorEnabled;
    private final String seatunnelBaseUrl;
    private final String notificationWebhookUrl;

    public RuntimeController(
            @Value("${data-os.seed-demo:false}") boolean seedDemoEnabled,
            @Value("${data-os.quality.executor:HTTP}") String qualityExecutor,
            @Value("${data-os.quality.base-url:}") String qualityExecutorBaseUrl,
            @Value("${data-os.quality.demo-enabled:false}") boolean demoQualityExecutorEnabled,
            @Value("${data-os.seatunnel.base-url:}") String seatunnelBaseUrl,
            @Value("${data-os.notification.webhook-url:}") String notificationWebhookUrl) {
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = normalize(qualityExecutor, "HTTP");
        this.qualityExecutorBaseUrl = normalizeUrl(qualityExecutorBaseUrl);
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.seatunnelBaseUrl = normalizeUrl(seatunnelBaseUrl);
        this.notificationWebhookUrl = normalizeUrl(notificationWebhookUrl);
    }

    @GetMapping("/status")
    public RuntimeStatus status() {
        var qualityConfigured = switch (qualityExecutor) {
            case "DEMO" -> demoQualityExecutorEnabled;
            case "HTTP", "DBT" -> !qualityExecutorBaseUrl.isBlank();
            default -> false;
        };
        var warnings = new ArrayList<String>();
        if (seedDemoEnabled) warnings.add("当前数据库允许写入演示种子数据");
        if ("DEMO".equals(qualityExecutor) && !demoQualityExecutorEnabled) {
            warnings.add("DEMO 质量执行器未启用，复检提交将被阻断");
        }
        if (!qualityConfigured) warnings.add("质量规则执行器未完成配置");
        if (seatunnelBaseUrl.isBlank()) warnings.add("SeaTunnel 执行器未配置");
        if (notificationWebhookUrl.isBlank()) warnings.add("责任人 Webhook 未配置，通知只会记录为 SKIPPED");
        var mode = seedDemoEnabled || ("DEMO".equals(qualityExecutor) && demoQualityExecutorEnabled)
                ? "DEMO" : "LIVE";
        return new RuntimeStatus(mode, seedDemoEnabled, qualityExecutor, qualityConfigured,
                demoQualityExecutorEnabled, !seatunnelBaseUrl.isBlank(),
                !notificationWebhookUrl.isBlank(), List.copyOf(warnings));
    }

    private String normalize(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizeUrl(String value) {
        return value == null ? "" : value.trim();
    }
}
