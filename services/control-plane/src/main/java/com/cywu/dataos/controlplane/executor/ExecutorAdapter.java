package com.cywu.dataos.controlplane.executor;

import java.util.Map;

import com.cywu.dataos.controlplane.job.IngestionJob;

public interface ExecutorAdapter {

    boolean supports(String executor);

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
