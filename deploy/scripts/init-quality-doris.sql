-- Run once with an approved Doris administrator on the existing FE.
-- No credentials are stored in this repository.
CREATE DATABASE IF NOT EXISTS dataos_quality_acceptance;
CREATE TABLE IF NOT EXISTS dataos_quality_acceptance.quality_sample (
    record_id VARCHAR(64),
    patient_id VARCHAR(128),
    status VARCHAR(32),
    updated_at DATETIME
)
DUPLICATE KEY(record_id)
DISTRIBUTED BY HASH(record_id) BUCKETS 1
PROPERTIES ("replication_num" = "1");

-- Use a dedicated least-privilege account in the hospital environment.
-- The actual CREATE USER/GRANT statements are intentionally parameterized by
-- the deployment operator because password material must never enter Git.
-- Doris 2.3+ also requires the query and cleanup accounts to have
-- `USAGE_PRIV` on the approved compute group (usually
-- `default_compute_group`).
--
-- Failure evidence now consumes dbt --store-failures tables in the audit
-- database, so the runtime query account only needs SELECT there (business
-- schemas are no longer read by the runtime itself; dbt reads them via
-- DORIS_DBT_USER):
--   CREATE DATABASE IF NOT EXISTS dataos_quality_audit;
--   GRANT SELECT_PRIV ON dataos_quality_audit.* TO '<quality query user>'@'%';
--   GRANT USAGE_PRIV ON COMPUTE GROUP default_compute_group TO '<quality query user>'@'%';
-- The dbt account keeps read access to the business schemas plus
-- CREATE/DROP on the audit database; the cleanup account stays DROP-only.
