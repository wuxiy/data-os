-- Scheduled checks that pass without an existing governance issue still need
-- an immutable execution-batch record for audit and reconciliation.
ALTER TABLE data_os.quality_rule_runs
    ALTER COLUMN issue_id DROP NOT NULL;
