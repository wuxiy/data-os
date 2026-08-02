package com.cywu.dataos.controlplane.job;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class RunRepository {

    private final JdbcTemplate jdbc;

    public RunRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public IngestionRun save(IngestionRun run) {
        jdbc.update("""
                INSERT INTO data_os.job_runs
                    (id, job_id, status, executor, external_id, message,
                     submitted_at, started_at, finished_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, run.id(), run.jobId(), run.status(), run.executor(), run.externalId(), run.message(),
                timestamp(run.submittedAt()), timestamp(run.startedAt()), timestamp(run.finishedAt()));
        return run;
    }

    public List<IngestionRun> findAll(String jobId) {
        return jdbc.query("""
                SELECT id, job_id, status, executor, external_id, message,
                       submitted_at, started_at, finished_at
                FROM data_os.job_runs
                WHERE job_id = ?
                ORDER BY submitted_at DESC
                """, (resultSet, rowNumber) -> new IngestionRun(
                resultSet.getString("id"),
                resultSet.getString("job_id"),
                resultSet.getString("status"),
                resultSet.getString("executor"),
                resultSet.getString("external_id"),
                resultSet.getString("message"),
                resultSet.getTimestamp("submitted_at").toInstant(),
                instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at"))), jobId);
    }

    private Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }
}
