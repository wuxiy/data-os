package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import com.cywu.dataos.controlplane.executor.AdapterRunStatus;
import com.cywu.dataos.controlplane.executor.AdapterSubmission;
import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import com.cywu.dataos.controlplane.security.AuthProperties;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import static org.assertj.core.api.Assertions.assertThat;

class IngestionRunServiceTest {

    @Test
    void writesNormalizedExternalStatusBackToRunRecord() {
        var run = new IngestionRun("run-1", "job-1", "SUBMITTED", "SEATUNNEL", "external-1",
                "中心采集执行器已接受提交", Instant.parse("2026-08-03T01:00:00Z"),
                Instant.parse("2026-08-03T01:00:01Z"), null);
        var updates = new ArrayList<String>();
        var repository = new RunRepository(null) {
            @Override
            public int recoverStaleSubmitting(long leaseMillis) {
                return 0;
            }

            @Override
            public List<IngestionRun> findSyncCandidates() {
                return List.of(run);
            }

            @Override
            public List<IngestionRun> findReconciliationCandidates() {
                return List.of();
            }

            @Override
            public int updateStatusAndJobLastRunAt(String runId, String jobId, String status, String message,
                                                   Instant startedAt, Instant finishedAt, Instant lastRunAt) {
                updates.add(runId + "|" + status + "|" + message + "|" + startedAt + "|" + finishedAt);
                return 1;
            }
        };
        var adapter = new ExecutorAdapter() {
            @Override
            public boolean supports(String executor) {
                return "SEATUNNEL".equals(executor);
            }

            @Override
            public AdapterSubmission submit(IngestionJob job, java.util.Map<String, Object> config) {
                throw new UnsupportedOperationException();
            }

            @Override
            public AdapterRunStatus status(String externalId) {
                return new AdapterRunStatus("SUCCEEDED", "中心采集作业已完成", run.startedAt(),
                        Instant.parse("2026-08-03T01:00:02Z"));
            }
        };

        var service = new IngestionRunService(
                null,
                repository,
                null,
                List.of(adapter),
                transactionManager(),
                new ObjectMapper(),
                new JobConfigurationPolicy("development"),
                new TenantScope(new AuthProperties()),
                null, 30_000, 120_000);

        service.syncPending();

        assertThat(updates)
                .containsExactly("run-1|SUCCEEDED|中心采集作业已完成|2026-08-03T01:00:01Z|2026-08-03T01:00:02Z");
    }

    @Test
    void reconcilesUnknownRunWithoutExternalIdWhenItIsAQueuedCandidate() {
        var run = new IngestionRun("run-2", "job-1", "UNKNOWN", "SEATUNNEL", null,
                "中心采集提交结果未知", null, null,
                Instant.parse("2026-08-03T01:00:00Z"), null, null);
        var reconciled = new ArrayList<String>();
        var repository = new RunRepository(null) {
            @Override
            public int recoverStaleSubmitting(long leaseMillis) {
                return 0;
            }

            @Override
            public List<IngestionRun> findSyncCandidates() {
                return List.of();
            }

            @Override
            public List<IngestionRun> findReconciliationCandidates() {
                return List.of(run);
            }

            @Override
            public int linkReconciledRun(String runId, String externalId, String status, String message,
                                         Instant startedAt, Instant finishedAt) {
                reconciled.add(runId + "|" + externalId + "|" + status);
                return 1;
            }

            @Override
            public int updateStatusAndJobLastRunAt(String runId, String jobId, String status, String message,
                                                   Instant startedAt, Instant finishedAt, Instant lastRunAt) {
                reconciled.add(runId + "|" + status);
                return 1;
            }
        };
        var adapter = new ExecutorAdapter() {
            @Override
            public boolean supports(String executor) {
                return "SEATUNNEL".equals(executor);
            }

            @Override
            public AdapterSubmission submit(IngestionJob job, java.util.Map<String, Object> config) {
                throw new UnsupportedOperationException();
            }

            @Override
            public AdapterRunStatus status(String externalId) {
                throw new UnsupportedOperationException();
            }

            @Override
            public com.cywu.dataos.controlplane.executor.AdapterReconciliation reconcile(String dataOsRunId) {
                return com.cywu.dataos.controlplane.executor.AdapterReconciliation.found(
                        "external-2", new AdapterRunStatus("RUNNING", "中心采集作业运行中", null, null), null);
            }
        };

        var service = new IngestionRunService(
                null, repository, null, List.of(adapter), transactionManager(),
                new ObjectMapper(), new JobConfigurationPolicy("development"),
                new TenantScope(new AuthProperties()), null, 30_000, 120_000);

        service.syncPending();

        assertThat(reconciled)
                .containsExactly("run-2|external-2|SUBMITTED", "run-2|RUNNING");
    }

    @Test
    void rejectsFoundReconciliationWithoutExternalId() {
        var run = new IngestionRun("run-3", "job-1", "UNKNOWN", "SEATUNNEL", null,
                "中心采集提交结果未知", null, null,
                Instant.parse("2026-08-03T01:00:00Z"), null, null);
        var outcomes = new ArrayList<String>();
        var repository = new RunRepository(null) {
            @Override
            public int recoverStaleSubmitting(long leaseMillis) {
                return 0;
            }

            @Override
            public List<IngestionRun> findSyncCandidates() {
                return List.of();
            }

            @Override
            public List<IngestionRun> findReconciliationCandidates() {
                return List.of(run);
            }

            @Override
            public int markReconciliationRequired(String runId, String message) {
                outcomes.add(runId + "|" + message);
                return 1;
            }
        };
        var adapter = new ExecutorAdapter() {
            @Override
            public boolean supports(String executor) {
                return "SEATUNNEL".equals(executor);
            }

            @Override
            public AdapterSubmission submit(IngestionJob job, java.util.Map<String, Object> config) {
                throw new UnsupportedOperationException();
            }

            @Override
            public AdapterRunStatus status(String externalId) {
                throw new UnsupportedOperationException();
            }

            @Override
            public com.cywu.dataos.controlplane.executor.AdapterReconciliation reconcile(String dataOsRunId) {
                return com.cywu.dataos.controlplane.executor.AdapterReconciliation.found(
                        " ", new AdapterRunStatus("RUNNING", "不应写入", null, null), null);
            }
        };

        var service = new IngestionRunService(
                null, repository, null, List.of(adapter), transactionManager(),
                new ObjectMapper(), new JobConfigurationPolicy("development"),
                new TenantScope(new AuthProperties()), null, 30_000, 120_000);

        service.syncPending();

        assertThat(outcomes).containsExactly("run-3|执行器返回了无效外部运行编号，请人工确认");
    }

    @Test
    void advancesCheckpointWithinTheStatusTransaction() {
        var run = new IngestionRun("run-4", "job-1", "SUBMITTED", "SEATUNNEL", "external-4",
                "中心采集执行器已接受提交", Instant.parse("2026-08-03T01:00:00Z"),
                Instant.parse("2026-08-03T01:00:01Z"), null);
        var events = new ArrayList<String>();
        var watermark = Instant.parse("2026-08-03T01:00:03Z");
        var repository = new RunRepository(null) {
            @Override
            public int recoverStaleSubmitting(long leaseMillis) {
                return 0;
            }

            @Override
            public List<IngestionRun> findSyncCandidates() {
                return List.of(run);
            }

            @Override
            public List<IngestionRun> findReconciliationCandidates() {
                return List.of();
            }

            @Override
            public int updateStatusAndJobLastRunAt(String runId, String jobId, String status, String message,
                                                   Instant startedAt, Instant finishedAt, Instant lastRunAt) {
                events.add("status");
                return 1;
            }

            @Override
            public java.util.Optional<Instant> findSourceWatermarkEnd(String runId) {
                return java.util.Optional.of(watermark);
            }

            @Override
            public int setSourceWatermarkEndBoundary(String runId, Instant watermarkEnd) {
                events.add("boundary");
                return 1;
            }
        };
        var checkpointRepository = new IngestionCheckpointRepository(null) {
            @Override
            public int advance(String jobId, String batchId, Instant watermarkEnd) {
                events.add("checkpoint");
                return 1;
            }
        };
        var adapter = new ExecutorAdapter() {
            @Override
            public boolean supports(String executor) {
                return "SEATUNNEL".equals(executor);
            }

            @Override
            public AdapterSubmission submit(IngestionJob job, java.util.Map<String, Object> config) {
                throw new UnsupportedOperationException();
            }

            @Override
            public AdapterRunStatus status(String externalId) {
                return new AdapterRunStatus("SUCCEEDED", "中心采集作业已完成", run.startedAt(), watermark);
            }
        };

        var service = new IngestionRunService(
                null, repository, null, List.of(adapter), transactionManager(events),
                new ObjectMapper(), new JobConfigurationPolicy("development"),
                new TenantScope(new AuthProperties()), checkpointRepository, 30_000, 120_000);

        service.syncPending();

        assertThat(events).containsExactly("begin", "status", "boundary", "checkpoint", "commit");
    }

    private static PlatformTransactionManager transactionManager() {
        return transactionManager(new ArrayList<>());
    }

    private static PlatformTransactionManager transactionManager(List<String> events) {
        return new PlatformTransactionManager() {
            @Override
            public TransactionStatus getTransaction(TransactionDefinition definition) {
                events.add("begin");
                return new SimpleTransactionStatus();
            }

            @Override
            public void commit(TransactionStatus status) {
                events.add("commit");
            }

            @Override
            public void rollback(TransactionStatus status) {
                events.add("rollback");
            }
        };
    }
}
