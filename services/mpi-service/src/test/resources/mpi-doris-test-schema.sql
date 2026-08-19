-- H2 模拟 Doris 侧结构（普通表代替 UNIQUE KEY 表；同名 schema 与 Doris 库一致）。
CREATE SCHEMA IF NOT EXISTS ods_ep;
CREATE SCHEMA IF NOT EXISTS dataos_mpi;

CREATE TABLE IF NOT EXISTS ods_ep.ep_mz_cfzb (
    YLJGDM VARCHAR(64),
    PATIENT_ID BIGINT,
    HZXM VARCHAR(128),
    HZXB VARCHAR(8),
    KH VARCHAR(64),
    HZNL VARCHAR(16),
    LXFS VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS dataos_mpi.mpi_source_identity (
    tenant_id VARCHAR(64),
    institution_code VARCHAR(64),
    source_system VARCHAR(32),
    source_key VARCHAR(128),
    patient_id VARCHAR(64),
    card_no_norm VARCHAR(64),
    name_norm VARCHAR(128),
    gender VARCHAR(8),
    age_display VARCHAR(16),
    contact_hash VARCHAR(128),
    id_card_hash VARCHAR(128),
    mpi_person_id VARCHAR(64),
    loaded_at TIMESTAMP,
    updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dataos_mpi.mpi_candidate_pair (
    pair_id BIGINT,
    tenant_id VARCHAR(64),
    identity_a VARCHAR(128),
    identity_b VARCHAR(128),
    blocking_rule VARCHAR(16),
    generated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dataos_mpi.mpi_match_result (
    pair_id BIGINT,
    tenant_id VARCHAR(64),
    identity_a VARCHAR(128),
    identity_b VARCHAR(128),
    rule_id VARCHAR(16),
    rule_version VARCHAR(32),
    outcome VARCHAR(24),
    evidence VARCHAR(4000),
    decided_at TIMESTAMP
);
