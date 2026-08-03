package com.cywu.dataos.controlplane.job;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JobRepository {

    private final JdbcTemplate jdbc;

    public JobRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<IngestionJob> findAll(String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT j.id, j.source_id, j.name, j.mode, j.executor, j.status, j.created_at,
                       (SELECT r.status FROM data_os.job_runs r
                        WHERE r.job_id = j.id ORDER BY r.submitted_at DESC LIMIT 1) AS latest_run_status,
                       j.last_run_at,
                       (SELECT c.template_key FROM data_os.ingestion_job_configs c
                        WHERE c.job_id = j.id) AS template_key,
                       (SELECT c.template_version FROM data_os.ingestion_job_configs c
                        WHERE c.job_id = j.id) AS template_version,
                       CASE WHEN EXISTS (SELECT 1 FROM data_os.ingestion_job_configs c
                                         WHERE c.job_id = j.id) THEN TRUE ELSE FALSE END AS configured
                FROM data_os.ingestion_jobs j
                JOIN data_os.sources s ON s.id = j.source_id
                WHERE s.tenant_id = ? AND s.institution_id = ?
                ORDER BY j.created_at DESC
                """, this::map, tenantId, institutionId);
    }

    public IngestionJob save(IngestionJob job) {
        jdbc.update("""
                INSERT INTO data_os.ingestion_jobs
                    (id, source_id, name, mode, executor, status, created_at, last_run_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, job.id(), job.sourceId(), job.name(), job.mode(), job.executor(), job.status(),
                Timestamp.from(job.createdAt()), timestamp(job.lastRunAt()));
        return job;
    }

    public Optional<IngestionJob> findById(String id) {
        return jdbc.query("""
                SELECT j.id, j.source_id, j.name, j.mode, j.executor, j.status, j.created_at,
                       (SELECT r.status FROM data_os.job_runs r
                        WHERE r.job_id = j.id ORDER BY r.submitted_at DESC LIMIT 1) AS latest_run_status,
                       j.last_run_at,
                       (SELECT c.template_key FROM data_os.ingestion_job_configs c
                        WHERE c.job_id = j.id) AS template_key,
                       (SELECT c.template_version FROM data_os.ingestion_job_configs c
                        WHERE c.job_id = j.id) AS template_version,
                       CASE WHEN EXISTS (SELECT 1 FROM data_os.ingestion_job_configs c
                                         WHERE c.job_id = j.id) THEN TRUE ELSE FALSE END AS configured
                FROM data_os.ingestion_jobs j
                WHERE j.id = ?
                """, this::map, id).stream().findFirst();
    }

    public Optional<IngestionJob> findByIdForUpdate(String id) {
        return jdbc.query("""
                SELECT j.id, j.source_id, j.name, j.mode, j.executor, j.status, j.created_at,
                       (SELECT r.status FROM data_os.job_runs r
                        WHERE r.job_id = j.id ORDER BY r.submitted_at DESC LIMIT 1) AS latest_run_status,
                       j.last_run_at,
                       (SELECT c.template_key FROM data_os.ingestion_job_configs c
                        WHERE c.job_id = j.id) AS template_key,
                       (SELECT c.template_version FROM data_os.ingestion_job_configs c
                        WHERE c.job_id = j.id) AS template_version,
                       CASE WHEN EXISTS (SELECT 1 FROM data_os.ingestion_job_configs c
                                         WHERE c.job_id = j.id) THEN TRUE ELSE FALSE END AS configured
                FROM data_os.ingestion_jobs j
                WHERE j.id = ?
                FOR UPDATE
                """, this::map, id).stream().findFirst();
    }

    private IngestionJob map(java.sql.ResultSet resultSet, int rowNumber) throws java.sql.SQLException {
        return new IngestionJob(
                resultSet.getString("id"),
                resultSet.getString("source_id"),
                resultSet.getString("name"),
                resultSet.getString("mode"),
                resultSet.getString("executor"),
                resultSet.getString("status"),
                resultSet.getTimestamp("created_at").toInstant(),
                resultSet.getString("latest_run_status"),
                resultSet.getTimestamp("last_run_at") == null ? null : resultSet.getTimestamp("last_run_at").toInstant(),
                resultSet.getString("template_key"),
                resultSet.getObject("template_version") == null ? null : resultSet.getInt("template_version"),
                resultSet.getBoolean("configured"));
    }

    private Timestamp timestamp(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }
}
