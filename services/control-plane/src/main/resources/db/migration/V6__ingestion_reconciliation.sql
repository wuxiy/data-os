ALTER TABLE data_os.job_runs
    ADD COLUMN IF NOT EXISTS reconciliation_status VARCHAR(40) NULL;

ALTER TABLE data_os.job_runs
    ADD COLUMN IF NOT EXISTS reconciliation_message VARCHAR(500) NULL;
