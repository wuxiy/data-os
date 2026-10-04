-- G2G 批次 4 第二刀：前置机发布记录（nema nodeDeploy 降格为登记面——
-- deploy/minifi 脚本产物版本与各节点发布史，不承载制品二进制）。
CREATE TABLE IF NOT EXISTS data_os.edge_deployments (
    id VARCHAR(36) PRIMARY KEY,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    node_id VARCHAR(36) NOT NULL,
    version VARCHAR(64) NOT NULL,
    artifact_ref VARCHAR(300) NOT NULL DEFAULT '',
    note VARCHAR(500) NOT NULL DEFAULT '',
    deployed_by VARCHAR(200) NOT NULL,
    deployed_at TIMESTAMP NOT NULL,
    CONSTRAINT fk_data_os_edge_deployment_node FOREIGN KEY (node_id)
        REFERENCES data_os.edge_nodes(id)
);
CREATE INDEX IF NOT EXISTS idx_data_os_edge_deployment_node
    ON data_os.edge_deployments(node_id, deployed_at DESC);
