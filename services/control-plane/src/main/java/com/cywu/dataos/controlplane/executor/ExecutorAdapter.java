package com.cywu.dataos.controlplane.executor;

import java.util.Map;

import com.cywu.dataos.controlplane.job.IngestionJob;

public interface ExecutorAdapter {

    boolean supports(String executor);

    AdapterSubmission submit(IngestionJob job, Map<String, Object> config);

    AdapterRunStatus status(String externalId);
}
