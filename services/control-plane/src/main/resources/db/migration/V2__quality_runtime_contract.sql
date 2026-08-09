ALTER TABLE data_os.governance_issues ADD COLUMN IF NOT EXISTS owner_id VARCHAR(200);
UPDATE data_os.governance_issues SET owner_id = owner_name WHERE owner_id IS NULL OR owner_id = '';
ALTER TABLE data_os.governance_issues ALTER COLUMN owner_id SET DEFAULT '';
ALTER TABLE data_os.governance_issues ALTER COLUMN owner_id SET NOT NULL;

ALTER TABLE data_os.governance_notifications ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(128);
ALTER TABLE data_os.governance_notifications ADD COLUMN IF NOT EXISTS institution_id VARCHAR(128);
ALTER TABLE data_os.governance_notifications ADD COLUMN IF NOT EXISTS recipient_id VARCHAR(200);
UPDATE data_os.governance_notifications notification
SET tenant_id = issue.tenant_id,
    institution_id = issue.institution_id,
    recipient_id = issue.owner_id
FROM data_os.governance_issues issue
WHERE notification.issue_id = issue.id
  AND (notification.tenant_id IS NULL OR notification.institution_id IS NULL OR notification.recipient_id IS NULL);
ALTER TABLE data_os.governance_notifications ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE data_os.governance_notifications ALTER COLUMN institution_id SET NOT NULL;
ALTER TABLE data_os.governance_notifications ALTER COLUMN recipient_id SET NOT NULL;
