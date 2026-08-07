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
}
