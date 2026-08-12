ALTER TABLE data_os.quality_rule_runs
    ADD COLUMN IF NOT EXISTS artifact_uri VARCHAR(1000) NULL;
