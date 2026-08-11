CREATE TABLE IF NOT EXISTS data_os.ingestion_checkpoints (
    job_id VARCHAR(36) PRIMARY KEY,
    last_success_watermark TIMESTAMP NULL,
    last_success_batch_id VARCHAR(36) NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_data_os_checkpoint_job FOREIGN KEY (job_id)
        REFERENCES data_os.ingestion_jobs(id)
);

ALTER TABLE data_os.job_runs ADD COLUMN IF NOT EXISTS source_watermark_start TIMESTAMP NULL;
ALTER TABLE data_os.job_runs ADD COLUMN IF NOT EXISTS source_watermark_end TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_data_os_checkpoint_updated
    ON data_os.ingestion_checkpoints(updated_at);
