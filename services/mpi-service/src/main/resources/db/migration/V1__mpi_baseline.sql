-- MPI 事务态基线（schema 由 provision 以独占账号为 owner 预建；此处幂等兜底）。
-- 方言纪律与 control-plane 一致：VARCHAR(36) 应用生成 UUID、JSON 以 TEXT 存、
-- 无 PG 特有扩展语法——保证 H2(PostgreSQL 模式) 迁移单测与生产同构。
CREATE SCHEMA IF NOT EXISTS data_os_mpi;

-- 黄金人：被判定为同一自然人的源身份集合的归一主体。
CREATE TABLE IF NOT EXISTS data_os_mpi.mpi_person (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    golden_name VARCHAR(128) NOT NULL,
    golden_gender VARCHAR(16),
    status VARCHAR(32) NOT NULL,
    created_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mpi_person_scope
    ON data_os_mpi.mpi_person (tenant_id, institution_id, status);

-- 源身份链接（crosswalk）：身份→黄金人的版本链，valid_to 为空即当前有效。
-- 「当前有效链接唯一」由决策服务在事务内保证（部分唯一索引不进基线，保持方言安全）。
CREATE TABLE IF NOT EXISTS data_os_mpi.mpi_person_link (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    person_id VARCHAR(36) NOT NULL,
    source_system VARCHAR(64) NOT NULL,
    source_identifier VARCHAR(256) NOT NULL,
    link_status VARCHAR(32) NOT NULL,
    decision_source VARCHAR(16) NOT NULL,
    rule_version VARCHAR(32),
    valid_from TIMESTAMP NOT NULL,
    valid_to TIMESTAMP NULL,
    created_by VARCHAR(128) NOT NULL,
    CONSTRAINT fk_mpi_link_person FOREIGN KEY (person_id) REFERENCES data_os_mpi.mpi_person(id)
);

CREATE INDEX IF NOT EXISTS idx_mpi_link_person
    ON data_os_mpi.mpi_person_link (person_id, valid_to);

CREATE INDEX IF NOT EXISTS idx_mpi_link_identity
    ON data_os_mpi.mpi_person_link (tenant_id, source_system, source_identifier);

-- 复核任务：REVIEW 态候选对的人工工作台任务。
CREATE TABLE IF NOT EXISTS data_os_mpi.mpi_review_task (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    pair_id BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    resolution VARCHAR(32),
    reason VARCHAR(500),
    created_at TIMESTAMP NOT NULL,
    resolved_by VARCHAR(128),
    resolved_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mpi_review_status
    ON data_os_mpi.mpi_review_task (tenant_id, institution_id, status);

-- 审计事件：不可变追加。detail 为脱敏 JSON（不含明文证件/联系方式）。
CREATE TABLE IF NOT EXISTS data_os_mpi.mpi_audit_event (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    action VARCHAR(64) NOT NULL,
    actor VARCHAR(128) NOT NULL,
    actor_type VARCHAR(16) NOT NULL,
    subject_type VARCHAR(32) NOT NULL,
    subject_id VARCHAR(128) NOT NULL,
    detail TEXT NOT NULL,
    rule_version VARCHAR(32),
    created_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mpi_audit_subject
    ON data_os_mpi.mpi_audit_event (subject_type, subject_id, created_at);

-- 规则版本：每次激活的规则集快照，匹配结果与审计引用此版本。
CREATE TABLE IF NOT EXISTS data_os_mpi.mpi_rule_version (
    version VARCHAR(32) PRIMARY KEY,
    description VARCHAR(500) NOT NULL,
    rules_json TEXT NOT NULL,
    activated_by VARCHAR(128) NOT NULL,
    activated_at TIMESTAMP NOT NULL
);
