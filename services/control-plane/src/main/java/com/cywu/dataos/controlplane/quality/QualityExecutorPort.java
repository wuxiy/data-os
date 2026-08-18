package com.cywu.dataos.controlplane.quality;

import java.util.List;
import java.util.Optional;

import com.cywu.dataos.controlplane.run.ExternalExecutorPort;
import com.cywu.dataos.controlplane.run.ExternalStatus;
import com.cywu.dataos.controlplane.run.ExternalSubmission;

/**
 * 质量规则执行器 seam 的 adapter：把 {@link QualityRuleExecutor} 的
 * 请求/结果形状映射为生命周期模块的中性会话。
 */
public class QualityExecutorPort
        implements ExternalExecutorPort<QualityRuleRun, QualityRuleExecutionRequest, QualityResultPayload> {

    private final List<QualityRuleExecutor> executors;

    public QualityExecutorPort(List<QualityRuleExecutor> executors) {
        this.executors = executors;
    }

    @Override
    public Optional<ExecutorSession<QualityRuleRun, QualityRuleExecutionRequest, QualityResultPayload>> find(
            QualityRuleRun run) {
        return executors.stream()
                .filter(item -> item.supports(run.executor()))
                .findFirst()
                .map(QualitySession::new);
    }

    private record QualitySession(QualityRuleExecutor executor)
            implements ExecutorSession<QualityRuleRun, QualityRuleExecutionRequest, QualityResultPayload> {

        @Override
        public ExternalSubmission submit(QualityRuleRun run, QualityRuleExecutionRequest command) {
            var submission = executor.submit(command);
            return submission == null ? null
                    : new ExternalSubmission(submission.externalId(), submission.message());
        }

        @Override
        public ExternalStatus<QualityResultPayload> status(QualityRuleRun run) {
            var result = executor.status(run.externalId());
            return new ExternalStatus<>(result.status(), result.message(), result.startedAt(),
                    result.finishedAt(), new QualityResultPayload(result.passed(),
                    result.executionBatchId(), result.sampleEvidence(), result.artifactUri()));
        }
    }
}
