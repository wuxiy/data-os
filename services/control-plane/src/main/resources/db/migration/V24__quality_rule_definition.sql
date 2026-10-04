-- G2G 批次 2（质量规则动态化）：动态质量规则定义台账。
-- 规则语义的执行属主在 quality-runner（registry + dbt 工程）；本表是控制面
-- 的定义与审计台账——保存/启停时把完整定义推送 runner 编译落库。
CREATE TABLE IF NOT EXISTS data_os.quality_rule_definitions (
    rule_id VARCHAR(200) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    rule_type VARCHAR(32) NOT NULL,
    dataset_id VARCHAR(300) NOT NULL,
    target_column VARCHAR(128) NOT NULL DEFAULT '',
    params_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_quality_rule_def_scope
    ON data_os.quality_rule_definitions(tenant_id, institution_id, enabled);
