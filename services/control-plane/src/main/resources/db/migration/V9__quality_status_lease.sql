ALTER TABLE data_os.quality_rule_runs
    ADD COLUMN IF NOT EXISTS status_lease_until TIMESTAMP NULL;

ALTER TABLE data_os.quality_rule_runs
    ADD COLUMN IF NOT EXISTS status_lease_by VARCHAR(128) NULL;
