-- G2G 批次 4（前置机运维域）：边缘节点台账。
-- 状态不落库——由最近一次中心探活衍生（ONLINE/OFFLINE/UNKNOWN），
-- 探测历史仅保留最近一次（轻量运维面，不做时序）。
CREATE TABLE IF NOT EXISTS data_os.edge_nodes (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    name VARCHAR(200) NOT NULL,
    group_name VARCHAR(128) NOT NULL DEFAULT '默认分组',
    site VARCHAR(128) NOT NULL DEFAULT '',
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    version VARCHAR(64) NOT NULL DEFAULT '',
    last_probe_at TIMESTAMP NULL,
    last_probe_ok BOOLEAN NULL,
    last_probe_message VARCHAR(500) NULL,
    config_json TEXT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_data_os_edge_node_name UNIQUE (tenant_id, institution_id, name)
);
CREATE INDEX IF NOT EXISTS idx_data_os_edge_node_scope
    ON data_os.edge_nodes(tenant_id, institution_id);
