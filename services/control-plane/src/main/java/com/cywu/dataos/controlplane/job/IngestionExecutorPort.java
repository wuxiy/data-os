package com.cywu.dataos.controlplane.job;

import java.util.List;
import java.util.Optional;

import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import com.cywu.dataos.controlplane.run.ExternalExecutorPort;
import com.cywu.dataos.controlplane.run.ExternalStatus;
import com.cywu.dataos.controlplane.run.ExternalSubmission;

/**
 * 采集执行器 seam 的 adapter：把 ExecutorAdapter（SeaTunnel、
 * DolphinScheduler）映射为生命周期模块的中性会话。
 */
public class IngestionExecutorPort implements ExternalExecutorPort<IngestionRun, IngestionSubmission, Void> {

    private final List<ExecutorAdapter> adapters;

    public IngestionExecutorPort(List<ExecutorAdapter> adapters) {
        this.adapters = adapters;
    }

    @Override
    public Optional<ExecutorSession<IngestionRun, IngestionSubmission, Void>> find(IngestionRun run) {
        return adapters.stream()
                .filter(adapter -> adapter.supports(run.executor()))
                .findFirst()
                .map(IngestionSession::new);
    }

    private record IngestionSession(ExecutorAdapter adapter)
            implements ExecutorSession<IngestionRun, IngestionSubmission, Void> {

        @Override
        public ExternalSubmission submit(IngestionRun run, IngestionSubmission command) {
            var submission = adapter.submit(command.job(), command.config(), run.id());
            return submission == null ? null
                    : new ExternalSubmission(submission.externalId(), submission.message());
        }

        @Override
        public ExternalStatus<Void> status(IngestionRun run) {
            var status = adapter.status(run.externalId());
            return new ExternalStatus<>(status.status(), status.message(), status.startedAt(),
                    status.finishedAt(), null);
        }

        @Override
        public com.cywu.dataos.controlplane.executor.AdapterReconciliation reconcile(IngestionRun run) {
            return adapter.reconcile(run.id());
        }
    }
}
