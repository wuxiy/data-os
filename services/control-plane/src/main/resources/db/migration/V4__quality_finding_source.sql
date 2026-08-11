ALTER TABLE data_os.governance_issues
    ADD COLUMN IF NOT EXISTS source_key VARCHAR(300) NULL;
ALTER TABLE data_os.governance_issues
    ADD COLUMN IF NOT EXISTS source_system VARCHAR(100) NOT NULL DEFAULT '';

-- Existing seeded or manually-created rows receive a stable legacy key before
-- the unique index is added. New quality findings must provide their own key.
UPDATE data_os.governance_issues
SET source_key = CONCAT('legacy:', id)
WHERE source_key IS NULL OR source_key = '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_os_issue_source
    ON data_os.governance_issues(tenant_id, institution_id, source_key);
