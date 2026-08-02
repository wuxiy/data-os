CREATE SCHEMA IF NOT EXISTS data_os;

CREATE TABLE IF NOT EXISTS data_os.sources (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    name VARCHAR(200) NOT NULL,
    system_type VARCHAR(64) NOT NULL,
    protocol VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT uq_data_os_source_name UNIQUE (tenant_id, institution_id, name)
);

CREATE TABLE IF NOT EXISTS data_os.ingestion_jobs (
    id VARCHAR(36) PRIMARY KEY,
    source_id VARCHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    mode VARCHAR(32) NOT NULL,
    executor VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    last_run_at TIMESTAMP NULL,
    CONSTRAINT fk_data_os_job_source FOREIGN KEY (source_id) REFERENCES data_os.sources(id)
);

CREATE TABLE IF NOT EXISTS data_os.governance_metrics (
    metric_key VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    label VARCHAR(200) NOT NULL,
    metric_value DECIMAL(18, 4) NOT NULL,
    unit VARCHAR(32) NOT NULL,
    target DECIMAL(18, 4) NULL,
    detail VARCHAR(500) NOT NULL,
    tone VARCHAR(32) NOT NULL,
    display_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS data_os.governance_issues (
    id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    title VARCHAR(300) NOT NULL,
    severity VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(200) NOT NULL,
    rule_id VARCHAR(200) NOT NULL,
    owner_department VARCHAR(200) NOT NULL,
    owner_name VARCHAR(200) NOT NULL,
    ticket_id VARCHAR(128) NOT NULL,
    impact VARCHAR(500) NOT NULL,
    due_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_data_os_jobs_source ON data_os.ingestion_jobs(source_id);
CREATE INDEX IF NOT EXISTS idx_data_os_issue_scope ON data_os.governance_issues(tenant_id, institution_id);

CREATE TABLE IF NOT EXISTS data_os.job_runs (
    id VARCHAR(36) PRIMARY KEY,
    job_id VARCHAR(36) NOT NULL,
    status VARCHAR(40) NOT NULL,
    executor VARCHAR(64) NOT NULL,
    external_id VARCHAR(128) NULL,
    message VARCHAR(500) NOT NULL,
    submitted_at TIMESTAMP NOT NULL,
    started_at TIMESTAMP NULL,
    finished_at TIMESTAMP NULL,
    CONSTRAINT fk_data_os_run_job FOREIGN KEY (job_id) REFERENCES data_os.ingestion_jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_data_os_runs_job ON data_os.job_runs(job_id, submitted_at DESC);
