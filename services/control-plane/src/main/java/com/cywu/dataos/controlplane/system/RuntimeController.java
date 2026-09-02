package com.cywu.dataos.controlplane.system;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import com.cywu.dataos.controlplane.operational.OperationalFacts;
import com.cywu.dataos.controlplane.operational.OperationalFactsRegistry;
import com.cywu.dataos.controlplane.quality.NotificationChannel;
import com.cywu.dataos.controlplane.quality.QualityRuleExecutor;
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
    private final List<QualityRuleExecutor> qualityExecutors;
    private final List<ExecutorAdapter> executorAdapters;
    private final List<NotificationChannel> notificationChannels;
    private final OperationalFactsRegistry operationalFacts;

    public RuntimeController(
            @Value("${data-os.seed-demo:false}") boolean seedDemoEnabled,
            @Value("${data-os.quality.executor:HTTP}") String qualityExecutor,
            @Value("${data-os.quality.demo-enabled:false}") boolean demoQualityExecutorEnabled,
            List<QualityRuleExecutor> qualityExecutors,
            List<ExecutorAdapter> executorAdapters,
            List<NotificationChannel> notificationChannels,
            OperationalFactsRegistry operationalFacts) {
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = normalize(qualityExecutor, "HTTP");
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.qualityExecutors = qualityExecutors;
        this.executorAdapters = executorAdapters;
        this.notificationChannels = notificationChannels;
        this.operationalFacts = operationalFacts;
        this.operationalFacts.updateConfiguration(qualityConfigured(), seatunnelConfigured(),
                notificationConfigured());
    }

    @GetMapping("/status")
    public RuntimeStatus status() {
        var qualityConfigured = qualityConfigured();
        var seatunnelConfigured = seatunnelConfigured();
        var notificationConfigured = notificationConfigured();
        var warnings = new ArrayList<String>();
        if (seedDemoEnabled) warnings.add("当前数据库允许写入演示种子数据");
        if ("DEMO".equals(qualityExecutor) && !demoQualityExecutorEnabled) {
            warnings.add("DEMO 质量执行器未启用，复检提交将被阻断");
        }
        if (!qualityConfigured) warnings.add("质量规则执行器未完成配置");
        if (!seatunnelConfigured) warnings.add("SeaTunnel 执行器未配置");
        // 通知配置的问题描述由通道自答（未配置 / 密钥缺失 / 强度不足）。
        for (var channel : notificationChannels) {
            var problem = channel.configurationProblem();
            if (!problem.isBlank()) warnings.add(problem);
        }
        var mode = seedDemoEnabled || ("DEMO".equals(qualityExecutor) && demoQualityExecutorEnabled)
                ? "DEMO" : "LIVE";
        OperationalFacts operational = operationalFacts.snapshot();
        return new RuntimeStatus(mode, seedDemoEnabled, qualityExecutor, qualityConfigured,
                demoQualityExecutorEnabled, seatunnelConfigured,
                notificationConfigured, operational, List.copyOf(warnings));
    }

    private String normalize(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim().toUpperCase(Locale.ROOT);
    }

    /** 「配置成什么样才算配置好」由执行器/通道自己回答，门户只按名路由询问。 */
    private boolean qualityConfigured() {
        return qualityExecutors.stream()
                .filter(executor -> executor.supports(qualityExecutor))
                .findFirst()
                .map(QualityRuleExecutor::configured)
                .orElse(false);
    }

    private boolean seatunnelConfigured() {
        return executorAdapters.stream()
                .filter(adapter -> adapter.supports("SEATUNNEL"))
                .findFirst()
                .map(ExecutorAdapter::configured)
                .orElse(false);
    }

    private boolean notificationConfigured() {
        return notificationChannels.stream()
                .filter(channel -> channel.supports("WEBHOOK"))
                .findFirst()
                .map(NotificationChannel::configured)
                .orElse(false);
    }
}
