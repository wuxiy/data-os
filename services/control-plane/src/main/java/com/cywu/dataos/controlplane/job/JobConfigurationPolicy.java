package com.cywu.dataos.controlplane.job;

import java.util.Collection;
import java.util.Map;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.system.RuntimeEnvironment;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Keeps demo-only ingestion templates out of explicitly marked production runs. */
@Component
public final class JobConfigurationPolicy {

    private final String environment;

    public JobConfigurationPolicy(@Value("${data-os.runtime.environment:production}") String environment) {
        this.environment = environment == null ? "" : environment.trim();
    }

    public void validateTemplateForSave(String templateKey) {
        if (isProduction() && isDemoTemplate(templateKey)) {
            throw new InvalidRequestException("生产环境不允许保存 FakeSource 演示模板，请改用真实连接器配置");
        }
    }

    public void validateRun(IngestionJob job, Map<String, Object> config) {
        if (isProduction() && (isDemoTemplate(job.templateKey()) || JobConfigTree.containsPlugin(config, "fakesource"))) {
            throw new ConflictException("生产环境不允许启动 FakeSource 演示采集任务");
        }
    }

    private boolean isProduction() {
        return RuntimeEnvironment.isProduction(environment);
    }

    private boolean isDemoTemplate(String templateKey) {
        return templateKey != null && "FAKE_TO_CONSOLE".equalsIgnoreCase(templateKey.trim());
    }
}
