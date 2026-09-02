package com.cywu.dataos.controlplane.executor;

import java.util.Map;
import java.util.Optional;

import com.cywu.dataos.controlplane.job.IngestionJob;

public interface ExecutorAdapter {

    boolean supports(String executor);

    /**
     * 「是否配置好」由执行器自答（base-url 等装配前提）——消费方
     * （运行状态、平台巡检）按名询问，不自行读取执行器配置键。
     */
    default boolean configured() {
        return false;
    }

    /** 就绪探测端点（绝对 URL）；空 = 无独立探针，configured 即视为就绪。 */
    default Optional<String> readinessEndpoint() {
        return Optional.empty();
    }

    /**
     * 平台巡检事实（厂商字段词表归 adapter；键为展示标签，值为展示值）。
     * 未配置返回空 Map；不可达抛 RuntimeException 由巡检方记 DOWN。
     */
    default Map<String, String> healthFacts() {
        return Map.of();
    }

    AdapterSubmission submit(IngestionJob job, Map<String, Object> config);

    /**
     * Submit with the durable data-os run id available to orchestrator
     * adapters. Existing adapters remain source-compatible; orchestrators can
     * place this value in their start parameters for duplicate detection.
     */
    default AdapterSubmission submit(IngestionJob job, Map<String, Object> config, String dataOsRunId) {
        return submit(job, config);
    }

    AdapterRunStatus status(String externalId);

    /**
     * Resolve a submission whose external id was lost after the request was
     * accepted.  Adapters that cannot query by the durable run id must return
     * MANUAL_REQUIRED instead of guessing or submitting again.
     */
    default AdapterReconciliation reconcile(String dataOsRunId) {
        return AdapterReconciliation.manualRequired("执行器不支持按 data_os_run_id 对账，请人工确认");
    }
}
