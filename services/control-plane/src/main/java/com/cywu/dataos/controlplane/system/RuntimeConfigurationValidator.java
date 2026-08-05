package com.cywu.dataos.controlplane.system;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Prevents an explicitly marked production deployment from starting with demo-only data or executors.
 */
@Component
public final class RuntimeConfigurationValidator {

    private final String environment;
    private final boolean seedDemoEnabled;
    private final String qualityExecutor;
    private final boolean demoQualityExecutorEnabled;

    public RuntimeConfigurationValidator(
            @Value("${data-os.runtime.environment:production}") String environment,
            @Value("${data-os.seed-demo:false}") boolean seedDemoEnabled,
            @Value("${data-os.quality.executor:HTTP}") String qualityExecutor,
            @Value("${data-os.quality.demo-enabled:false}") boolean demoQualityExecutorEnabled) {
        this.environment = environment;
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = qualityExecutor;
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
    }

    @PostConstruct
    public void validate() {
        if (!"production".equalsIgnoreCase(normalize(environment))) {
            return;
        }
        if (seedDemoEnabled || demoQualityExecutorEnabled || "DEMO".equalsIgnoreCase(normalize(qualityExecutor))) {
            throw new IllegalStateException(
                    "生产环境禁止启用演示种子数据或 DEMO 质量执行器，请设置 DATAOS_SEED_DEMO=false、"
                            + "DATAOS_QUALITY_EXECUTOR=HTTP/DBT、DATAOS_QUALITY_DEMO_ENABLED=false");
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
