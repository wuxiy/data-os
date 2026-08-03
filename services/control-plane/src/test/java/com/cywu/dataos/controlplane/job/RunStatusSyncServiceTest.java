package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import com.cywu.dataos.controlplane.executor.AdapterRunStatus;
import com.cywu.dataos.controlplane.executor.AdapterSubmission;
import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import org.junit.jupiter.api.Test;

class RunStatusSyncServiceTest {

    @Test
    void writesNormalizedExternalStatusBackToRunRecord() {
        var run = new IngestionRun("run-1", "job-1", "SUBMITTED", "SEATUNNEL", "external-1",
                "中心采集执行器已接受提交", Instant.parse("2026-08-03T01:00:00Z"),
                Instant.parse("2026-08-03T01:00:01Z"), null);
        var updates = new ArrayList<String>();
        var repository = new RunRepository(null) {
            @Override
            public List<IngestionRun> findSyncCandidates() {
                return List.of(run);
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

        var service = new RunStatusSyncService(repository, List.of(adapter));

        service.syncPendingRuns();

        org.assertj.core.api.Assertions.assertThat(updates)
                .containsExactly("run-1|SUCCEEDED|中心采集作业已完成|2026-08-03T01:00:01Z|2026-08-03T01:00:02Z");
    }
}
