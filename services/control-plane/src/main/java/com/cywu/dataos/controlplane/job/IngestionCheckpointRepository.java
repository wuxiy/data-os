package com.cywu.dataos.controlplane.job;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Durable at-least-once watermark for a single ingestion job. */
@Repository
public class IngestionCheckpointRepository {

    private final JdbcTemplate jdbc;

    public IngestionCheckpointRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Instant> findLastSuccessWatermark(String jobId) {
        return jdbc.query("""
                SELECT last_success_watermark
                FROM data_os.ingestion_checkpoints
                WHERE job_id = ?
                """, (resultSet, rowNumber) -> resultSet.getTimestamp("last_success_watermark"), jobId)
                .stream()
                .filter(value -> value != null)
                .map(Timestamp::toInstant)
                .findFirst();
    }

    /**
     * Advance only after the sink/executor reports success. The batch id makes
     * repeated status polls harmless, while the timestamp guard prevents a
     * late older run from moving the checkpoint backwards.
     */
    public int advance(String jobId, String batchId, Instant watermark) {
        if (jobId == null || batchId == null || batchId.isBlank() || watermark == null) return 0;
        return jdbc.update("""
                INSERT INTO data_os.ingestion_checkpoints
                    (job_id, last_success_watermark, last_success_batch_id, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (job_id) DO UPDATE SET
                    last_success_watermark = EXCLUDED.last_success_watermark,
                    last_success_batch_id = EXCLUDED.last_success_batch_id,
                    updated_at = CURRENT_TIMESTAMP
                WHERE data_os.ingestion_checkpoints.last_success_batch_id IS DISTINCT FROM EXCLUDED.last_success_batch_id
                  AND (data_os.ingestion_checkpoints.last_success_watermark IS NULL
                       OR data_os.ingestion_checkpoints.last_success_watermark <= EXCLUDED.last_success_watermark)
                """, jobId, Timestamp.from(watermark), batchId);
    }
}
