package com.cywu.dataos.controlplane.job;

import java.sql.Timestamp;
import java.sql.ResultSet;
import java.sql.SQLException;
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
                     reconciliation_status, reconciliation_message, submitted_at, started_at, finished_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, run.id(), run.jobId(), run.status(), run.executor(), run.externalId(), requestKey,
                requestFingerprint, run.message(), run.reconciliationStatus(), run.reconciliationMessage(),
                timestamp(run.submittedAt()), timestamp(run.startedAt()), timestamp(run.finishedAt()));
        return run;
    }

    public int setSourceWatermarkStart(String runId, Instant watermarkStart) {
        return jdbc.update("""
                UPDATE data_os.job_runs
                SET source_watermark_start = ?
                WHERE id = ? AND source_watermark_start IS NULL
                """, timestamp(watermarkStart), runId);
    }

    /** Persist the upper bound captured before the source query starts. */
    public int setSourceWatermarkEndBoundary(String runId, Instant watermarkEnd) {
        return jdbc.update("""
                UPDATE data_os.job_runs
                SET source_watermark_end = ?
                WHERE id = ? AND source_watermark_end IS NULL
                """, timestamp(watermarkEnd), runId);
    }

    public Optional<Instant> findSourceWatermarkEnd(String runId) {
        return jdbc.query("""
                SELECT source_watermark_end
                FROM data_os.job_runs
                WHERE id = ?
                """, (resultSet, rowNumber) -> resultSet.getTimestamp("source_watermark_end"), runId)
                .stream()
                .filter(value -> value != null)
                .map(Timestamp::toInstant)
                .findFirst();
    }

    public Optional<RunRequest> findByRequestKey(String jobId, String requestKey) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, request_fingerprint, message,
                       reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE job_id = ? AND request_key = ?
                ORDER BY submitted_at DESC
                LIMIT 1
                """, (resultSet, rowNumber) -> new RunRequest(mapRun(resultSet, rowNumber),
                        resultSet.getString("request_fingerprint")), jobId, requestKey).stream().findFirst();
    }

    public List<IngestionRun> findAll(String jobId) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE job_id = ?
                ORDER BY submitted_at DESC
                """, this::mapRun, jobId);
    }

    public List<IngestionRun> findAll(String jobId, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT r.id, r.job_id, r.status, r.executor, r.external_id, r.message,
                       r.reconciliation_status, r.reconciliation_message,
                       r.submitted_at, r.started_at, r.finished_at
                FROM data_os.job_runs r
                JOIN data_os.ingestion_jobs j ON j.id = r.job_id
                JOIN data_os.sources s ON s.id = j.source_id
                WHERE r.job_id = ? AND s.tenant_id = ? AND s.institution_id = ?
                ORDER BY r.submitted_at DESC
                """, this::mapRun, jobId, tenantId, institutionId);
    }

    public List<IngestionRun> findSyncCandidates() {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE external_id IS NOT NULL
                  AND status IN ('SUBMITTED', 'RUNNING', 'UNKNOWN')
                  AND (reconciliation_status IS NULL OR reconciliation_status <> 'MANUAL_REQUIRED')
                ORDER BY submitted_at ASC
                LIMIT 100
                """, this::mapRun);
    }

    public List<IngestionRun> findReconciliationCandidates() {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE status = 'UNKNOWN' AND external_id IS NULL
                  AND reconciliation_status IS NULL
                ORDER BY submitted_at ASC
                LIMIT 100
                """, this::mapRun);
    }

    /** Queue a lost pre-submit lease for adapter reconciliation instead of leaving it stuck forever. */
    public int recoverStaleSubmitting(long leaseMillis) {
        if (leaseMillis < 1) return 0;
        return jdbc.update("""
                UPDATE data_os.job_runs
                SET status = 'UNKNOWN',
                    message = '提交请求可能已被执行器接受，正在等待人工/执行器对账',
                    reconciliation_status = NULL,
                    reconciliation_message = '控制面未收到外部运行编号；请人工先按 data_os_run_id 对账，确认不存在后再重试',
                    finished_at = NULL
                WHERE status = 'SUBMITTING' AND submitted_at < ?
                """, timestamp(Instant.now().minusMillis(leaseMillis)));
    }

    public Optional<IngestionRun> findById(String jobId, String runId) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE id = ? AND job_id = ?
                """, this::mapRun, runId, jobId).stream().findFirst();
    }

    public Optional<IngestionRun> findById(String jobId, String runId, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT r.id, r.job_id, r.status, r.executor, r.external_id, r.message,
                       r.reconciliation_status, r.reconciliation_message,
                       r.submitted_at, r.started_at, r.finished_at
                FROM data_os.job_runs r
                JOIN data_os.ingestion_jobs j ON j.id = r.job_id
                JOIN data_os.sources s ON s.id = j.source_id
                WHERE r.id = ? AND r.job_id = ? AND s.tenant_id = ? AND s.institution_id = ?
                """, this::mapRun, runId, jobId, tenantId, institutionId).stream().findFirst();
    }

    public Optional<IngestionRun> findActive(String jobId) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE job_id = ? AND status IN ('SUBMITTING', 'SUBMITTED', 'RUNNING', 'UNKNOWN')
                ORDER BY submitted_at DESC
                LIMIT 1
                FOR UPDATE
                """, this::mapRun, jobId).stream().findFirst();
    }

    public int updateStatus(String runId, String status, String message, Instant startedAt, Instant finishedAt) {
        return jdbc.update("""
                UPDATE data_os.job_runs
                SET status = ?, message = ?,
                    reconciliation_status = CASE WHEN ? = 'UNKNOWN' THEN 'MANUAL_REQUIRED' ELSE NULL END,
                    reconciliation_message = CASE WHEN ? = 'UNKNOWN' THEN ? ELSE NULL END,
                    started_at = COALESCE(?, started_at),
                    finished_at = COALESCE(?, finished_at)
                WHERE id = ?
                  AND status IN ('SUBMITTING', 'SUBMITTED', 'RUNNING', 'UNKNOWN')
                  AND NOT (status = 'RUNNING' AND ? = 'SUBMITTED')
                """, status, message, status, status, message, timestamp(startedAt), timestamp(finishedAt), runId, status);
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
                    reconciliation_status = CASE WHEN ? = 'UNKNOWN' THEN 'MANUAL_REQUIRED' ELSE NULL END,
                    reconciliation_message = CASE WHEN ? = 'UNKNOWN' THEN ? ELSE NULL END,
                    started_at = COALESCE(?, started_at),
                    finished_at = COALESCE(?, finished_at)
                WHERE id = ? AND status = 'SUBMITTING'
                """, status, externalId, message, status, status, message, timestamp(startedAt),
                timestamp(finishedAt), runId);
        if (updated > 0) {
            updateJobLastRunAt(jobId, lastRunAt);
        }
        return updated;
    }

    public int linkReconciledRun(String runId, String externalId, String status, String message,
                                 Instant startedAt, Instant finishedAt) {
        return jdbc.update("""
                UPDATE data_os.job_runs
                SET status = ?, external_id = ?, message = ?,
                    reconciliation_status = 'FOUND', reconciliation_message = ?,
                    started_at = COALESCE(?, started_at), finished_at = COALESCE(?, finished_at)
                WHERE id = ? AND status = 'UNKNOWN' AND external_id IS NULL
                """, status, externalId, message, message, timestamp(startedAt), timestamp(finishedAt), runId);
    }

    public int markReconciliationRequired(String runId, String message) {
        return jdbc.update("""
                UPDATE data_os.job_runs
                SET status = 'UNKNOWN', reconciliation_status = 'MANUAL_REQUIRED',
                    reconciliation_message = ?, message = ?
                WHERE id = ? AND status = 'UNKNOWN' AND external_id IS NULL
                """, message, message, runId);
    }

    public int confirmAbsent(String runId, String message) {
        return jdbc.update("""
                UPDATE data_os.job_runs
                SET status = 'SUBMIT_FAILED', reconciliation_status = 'CONFIRMED_ABSENT',
                    reconciliation_message = ?, message = ?, finished_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'UNKNOWN'
                  AND reconciliation_status = 'MANUAL_REQUIRED'
                """, message, message, runId);
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

    private IngestionRun mapRun(ResultSet resultSet, int rowNumber) throws SQLException {
        return new IngestionRun(
                resultSet.getString("id"), resultSet.getString("job_id"), resultSet.getString("status"),
                resultSet.getString("executor"), resultSet.getString("external_id"), resultSet.getString("message"),
                resultSet.getString("reconciliation_status"), resultSet.getString("reconciliation_message"),
                resultSet.getTimestamp("submitted_at").toInstant(), instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at")));
    }

    public record RunRequest(IngestionRun run, String requestFingerprint) {
    }
}
