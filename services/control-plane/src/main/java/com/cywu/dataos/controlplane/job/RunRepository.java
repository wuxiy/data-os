package com.cywu.dataos.controlplane.job;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class RunRepository {

    private final JdbcTemplate jdbc;

    public RunRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public IngestionRun save(IngestionRun run) {
        return save(run, null);
    }

    public IngestionRun save(IngestionRun run, String requestKey) {
        return save(run, requestKey, null);
    }

    public IngestionRun save(IngestionRun run, String requestKey, String requestFingerprint) {
        jdbc.update("""
                INSERT INTO data_os.job_runs
                    (id, job_id, status, executor, external_id, request_key, request_fingerprint, message,
                     submitted_at, started_at, finished_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, run.id(), run.jobId(), run.status(), run.executor(), run.externalId(), requestKey,
                requestFingerprint, run.message(),
                timestamp(run.submittedAt()), timestamp(run.startedAt()), timestamp(run.finishedAt()));
        return run;
    }

    public Optional<RunRequest> findByRequestKey(String jobId, String requestKey) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, request_fingerprint, message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE job_id = ? AND request_key = ?
                ORDER BY submitted_at DESC
                LIMIT 1
                """, (resultSet, rowNumber) -> new RunRequest(new IngestionRun(
                        resultSet.getString("id"), resultSet.getString("job_id"), resultSet.getString("status"),
                        resultSet.getString("executor"), resultSet.getString("external_id"),
                        resultSet.getString("message"), resultSet.getTimestamp("submitted_at").toInstant(),
                        instant(resultSet.getTimestamp("started_at")), instant(resultSet.getTimestamp("finished_at"))),
                resultSet.getString("request_fingerprint")), jobId, requestKey).stream().findFirst();
    }

    public List<IngestionRun> findAll(String jobId) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE job_id = ?
                ORDER BY submitted_at DESC
                """, (resultSet, rowNumber) -> new IngestionRun(
                resultSet.getString("id"), resultSet.getString("job_id"), resultSet.getString("status"),
                resultSet.getString("executor"), resultSet.getString("external_id"), resultSet.getString("message"),
                resultSet.getTimestamp("submitted_at").toInstant(), instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at"))), jobId);
    }

    public List<IngestionRun> findAll(String jobId, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT r.id, r.job_id, r.status, r.executor, r.external_id, r.message,
                       r.submitted_at, r.started_at, r.finished_at
                FROM data_os.job_runs r
                JOIN data_os.ingestion_jobs j ON j.id = r.job_id
                JOIN data_os.sources s ON s.id = j.source_id
                WHERE r.job_id = ? AND s.tenant_id = ? AND s.institution_id = ?
                ORDER BY r.submitted_at DESC
                """, (resultSet, rowNumber) -> new IngestionRun(
                resultSet.getString("id"), resultSet.getString("job_id"), resultSet.getString("status"),
                resultSet.getString("executor"), resultSet.getString("external_id"), resultSet.getString("message"),
                resultSet.getTimestamp("submitted_at").toInstant(), instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at"))), jobId, tenantId, institutionId);
    }

    public List<IngestionRun> findSyncCandidates() {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE external_id IS NOT NULL
                  AND status IN ('SUBMITTED', 'RUNNING')
                ORDER BY submitted_at ASC
                LIMIT 100
                """, (resultSet, rowNumber) -> new IngestionRun(
                resultSet.getString("id"), resultSet.getString("job_id"), resultSet.getString("status"),
                resultSet.getString("executor"), resultSet.getString("external_id"), resultSet.getString("message"),
                resultSet.getTimestamp("submitted_at").toInstant(), instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at"))));
    }

    public Optional<IngestionRun> findById(String jobId, String runId) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE id = ? AND job_id = ?
                """, (resultSet, rowNumber) -> new IngestionRun(
                resultSet.getString("id"), resultSet.getString("job_id"), resultSet.getString("status"),
                resultSet.getString("executor"), resultSet.getString("external_id"), resultSet.getString("message"),
                resultSet.getTimestamp("submitted_at").toInstant(), instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at"))), runId, jobId).stream().findFirst();
    }

    public Optional<IngestionRun> findById(String jobId, String runId, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT r.id, r.job_id, r.status, r.executor, r.external_id, r.message,
                       r.submitted_at, r.started_at, r.finished_at
                FROM data_os.job_runs r
                JOIN data_os.ingestion_jobs j ON j.id = r.job_id
                JOIN data_os.sources s ON s.id = j.source_id
                WHERE r.id = ? AND r.job_id = ? AND s.tenant_id = ? AND s.institution_id = ?
                """, (resultSet, rowNumber) -> new IngestionRun(
                resultSet.getString("id"), resultSet.getString("job_id"), resultSet.getString("status"),
                resultSet.getString("executor"), resultSet.getString("external_id"), resultSet.getString("message"),
                resultSet.getTimestamp("submitted_at").toInstant(), instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at"))), runId, jobId, tenantId, institutionId).stream().findFirst();
    }

    public Optional<IngestionRun> findActive(String jobId) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE job_id = ? AND status IN ('SUBMITTING', 'SUBMITTED', 'RUNNING', 'UNKNOWN')
                ORDER BY submitted_at DESC
                LIMIT 1
                FOR UPDATE
                """, (resultSet, rowNumber) -> new IngestionRun(
                resultSet.getString("id"), resultSet.getString("job_id"), resultSet.getString("status"),
                resultSet.getString("executor"), resultSet.getString("external_id"), resultSet.getString("message"),
                resultSet.getTimestamp("submitted_at").toInstant(), instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at"))), jobId).stream().findFirst();
    }

    public int updateStatus(String runId, String status, String message, Instant startedAt, Instant finishedAt) {
        return jdbc.update("""
                UPDATE data_os.job_runs
                SET status = ?, message = ?,
                    started_at = COALESCE(?, started_at),
                    finished_at = COALESCE(?, finished_at)
                WHERE id = ?
                  AND status IN ('SUBMITTING', 'SUBMITTED', 'RUNNING', 'UNKNOWN')
                  AND NOT (status = 'RUNNING' AND ? = 'SUBMITTED')
                """, status, message, timestamp(startedAt), timestamp(finishedAt), runId, status);
    }

    @Transactional
    public int updateStatusAndJobLastRunAt(String runId, String jobId, String status, String message,
                                           Instant startedAt, Instant finishedAt, Instant lastRunAt) {
        var updated = updateStatus(runId, status, message, startedAt, finishedAt);
        if (updated > 0) {
            updateJobLastRunAt(jobId, lastRunAt);
        }
        return updated;
    }

    @Transactional
    public int completeSubmissionAndJobLastRunAt(String runId, String jobId, String status, String externalId,
                                                 String message, Instant startedAt, Instant finishedAt,
                                                 Instant lastRunAt) {
        var updated = jdbc.update("""
                UPDATE data_os.job_runs
                SET status = ?, external_id = ?, message = ?,
                    started_at = COALESCE(?, started_at),
                    finished_at = COALESCE(?, finished_at)
                WHERE id = ? AND status = 'SUBMITTING'
                """, status, externalId, message, timestamp(startedAt), timestamp(finishedAt), runId);
        if (updated > 0) {
            updateJobLastRunAt(jobId, lastRunAt);
        }
        return updated;
    }

    public void updateJobLastRunAt(String jobId, Instant lastRunAt) {
        jdbc.update("""
                UPDATE data_os.ingestion_jobs
                SET last_run_at = COALESCE(?, last_run_at)
                WHERE id = ?
                """, timestamp(lastRunAt), jobId);
    }

    private Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public record RunRequest(IngestionRun run, String requestFingerprint) {
    }
}
