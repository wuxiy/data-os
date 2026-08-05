package com.cywu.dataos.controlplane.quality;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Deterministic development executor. It keeps no business result in the
 * database and is intentionally disabled in production deployments.
 */
@Component
public class DemoQualityRuleExecutor implements QualityRuleExecutor {

    private final Map<String, DemoRun> runs = new ConcurrentHashMap<>();
    private final long delayMs;

    public DemoQualityRuleExecutor(@Value("${data-os.quality.demo-delay-ms:500}") long delayMs) {
        this.delayMs = Math.max(0, delayMs);
    }

    @Override
    public boolean supports(String executor) {
        return "DEMO".equalsIgnoreCase(executor);
    }

    @Override
    public QualityRuleSubmission submit(QualityRuleExecutionRequest request) {
        var externalId = "demo-quality-" + UUID.randomUUID();
        runs.put(externalId, new DemoRun(request, Instant.now()));
        return new QualityRuleSubmission(externalId, "开发质量规则执行器已接受复检");
    }

    @Override
    public QualityRuleExecutionStatus status(String externalId) {
        var run = runs.get(externalId);
        if (run == null) {
            return new QualityRuleExecutionStatus("UNKNOWN", null, "开发质量规则执行器未找到批次",
                    null, List.of(), null, null);
        }
        var startedAt = run.submittedAt();
        if (Duration.between(run.submittedAt(), Instant.now()).toMillis() < delayMs) {
            return new QualityRuleExecutionStatus("RUNNING", null, "开发质量规则执行器执行中",
                    run.request().executionBatchId(), List.of(), startedAt, null);
        }
        var passed = passRule(run.request().ruleId());
        var evidence = List.of(Map.<String, Object>of(
                "datasetId", run.request().datasetId(),
                "ruleId", run.request().ruleId(),
                "sampleKey", passed ? "sample-healthy-001" : "sample-failed-001",
                "observed", passed ? "通过" : "存在不符合规则的样本"));
        return new QualityRuleExecutionStatus("SUCCEEDED", passed,
                passed ? "开发质量规则执行通过" : "开发质量规则执行失败，已返回样本证据",
                run.request().executionBatchId(), evidence, startedAt, Instant.now());
    }

    private boolean passRule(String ruleId) {
        var value = ruleId == null ? "" : ruleId.toLowerCase();
        return value.contains("pass") || value.contains("required") || value.contains("complete")
                || value.contains("valid");
    }

    private record DemoRun(QualityRuleExecutionRequest request, Instant submittedAt) {
    }
}
