package com.cywu.dataos.controlplane.quality;

public interface QualityRuleExecutor {

    boolean supports(String executor);

    QualityRuleSubmission submit(QualityRuleExecutionRequest request);

    QualityRuleExecutionStatus status(String externalId);
}
