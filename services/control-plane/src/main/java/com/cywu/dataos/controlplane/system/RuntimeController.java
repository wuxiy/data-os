package com.cywu.dataos.controlplane.system;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.cywu.dataos.controlplane.operational.OperationalFacts;
import com.cywu.dataos.controlplane.operational.OperationalFactsRegistry;
import com.cywu.dataos.controlplane.quality.QualityRuleExecutor;
import com.cywu.dataos.controlplane.quality.WebhookSecretProvider;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/system")
public class RuntimeController {

    private final boolean seedDemoEnabled;
    private final String qualityExecutor;
    private final boolean demoQualityExecutorEnabled;
    private final String seatunnelBaseUrl;
    private final List<QualityRuleExecutor> qualityExecutors;
    private final String notificationWebhookUrl;
    private final WebhookSecretProvider notificationSecrets;
    private final OperationalFactsRegistry operationalFacts;

    public RuntimeController(
            @Value("${data-os.seed-demo:false}") boolean seedDemoEnabled,
            @Value("${data-os.quality.executor:HTTP}") String qualityExecutor,
            @Value("${data-os.quality.demo-enabled:false}") boolean demoQualityExecutorEnabled,
            List<QualityRuleExecutor> qualityExecutors,
            @Value("${data-os.seatunnel.base-url:}") String seatunnelBaseUrl,
            @Value("${data-os.notification.webhook-url:}") String notificationWebhookUrl,
            @Value("${data-os.notification.webhook-secret:}") String notificationWebhookSecret,
            @Value("${data-os.notification.webhook-secret-file:}") String notificationWebhookSecretFile,
            ObjectMapper objectMapper,
            OperationalFactsRegistry operationalFacts) {
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = normalize(qualityExecutor, "HTTP");
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.qualityExecutors = qualityExecutors;
        this.seatunnelBaseUrl = normalizeUrl(seatunnelBaseUrl);
        this.notificationWebhookUrl = normalizeUrl(notificationWebhookUrl);
        this.notificationSecrets = new WebhookSecretProvider(objectMapper, notificationWebhookSecret,
                notificationWebhookSecretFile);
        this.operationalFacts = operationalFacts;
        this.operationalFacts.updateConfiguration(qualityConfigured(), !this.seatunnelBaseUrl.isBlank(),
                notificationConfigured());
    }

    @GetMapping("/status")
    public RuntimeStatus status() {
        var qualityConfigured = qualityConfigured();
        var warnings = new ArrayList<String>();
        if (seedDemoEnabled) warnings.add("当前数据库允许写入演示种子数据");
        if ("DEMO".equals(qualityExecutor) && !demoQualityExecutorEnabled) {
            warnings.add("DEMO 质量执行器未启用，复检提交将被阻断");
        }
        if (!qualityConfigured) warnings.add("质量规则执行器未完成配置");
        if (seatunnelBaseUrl.isBlank()) warnings.add("SeaTunnel 执行器未配置");
        var notificationConfigured = notificationConfigured();
        if (notificationWebhookUrl.isBlank()) {
            warnings.add("责任人 Webhook 未配置，通知只会记录为 SKIPPED");
        } else if (!notificationConfigured) {
            warnings.add("责任人 Webhook 签名密钥缺失或强度不足，通知不会发送");
        }
        var mode = seedDemoEnabled || ("DEMO".equals(qualityExecutor) && demoQualityExecutorEnabled)
                ? "DEMO" : "LIVE";
        OperationalFacts operational = operationalFacts.snapshot();
        return new RuntimeStatus(mode, seedDemoEnabled, qualityExecutor, qualityConfigured,
                demoQualityExecutorEnabled, !seatunnelBaseUrl.isBlank(),
                notificationConfigured, operational, List.copyOf(warnings));
    }

    private String normalize(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim().toUpperCase(Locale.ROOT);
    }

    private String normalizeUrl(String value) {
        return value == null ? "" : value.trim();
    }

    /** 「配置成什么样才算配置好」由执行器自己回答，门户只按名路由询问。 */
    private boolean qualityConfigured() {
        return qualityExecutors.stream()
                .filter(executor -> executor.supports(qualityExecutor))
                .findFirst()
                .map(QualityRuleExecutor::configured)
                .orElse(false);
    }

    private boolean notificationConfigured() {
        return !notificationWebhookUrl.isBlank() && notificationSecrets.current().length() >= 32;
    }
}
