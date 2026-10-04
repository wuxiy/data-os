package com.cywu.dataos.controlplane.edge;

import java.sql.Timestamp;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 前置机发布记录（V27）。 */
@Repository
public class EdgeDeploymentRepository {

    private final JdbcTemplate jdbc;

    public EdgeDeploymentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(EdgeDeployment deployment) {
        jdbc.update("""
                INSERT INTO data_os.edge_deployments
                    (id, tenant_id, institution_id, node_id, version, artifact_ref, note, deployed_by, deployed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, deployment.id(), tenantOf(deployment.nodeId()), institutionOf(deployment.nodeId()),
                deployment.nodeId(), deployment.version(), deployment.artifactRef(), deployment.note(),
                deployment.deployedBy(), Timestamp.from(deployment.deployedAt()));
    }

    public List<EdgeDeployment> findByNode(String nodeId, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, node_id, version, artifact_ref, note, deployed_by, deployed_at
                FROM data_os.edge_deployments
                WHERE node_id = ? AND tenant_id = ? AND institution_id = ?
                ORDER BY deployed_at DESC
                """, (rs, i) -> new EdgeDeployment(
                rs.getString("id"), rs.getString("node_id"), rs.getString("version"),
                rs.getString("artifact_ref"), rs.getString("note"), rs.getString("deployed_by"),
                rs.getTimestamp("deployed_at").toInstant()), nodeId, tenantId, institutionId);
    }

    // insert 时的租户列取台账行（服务层已 require 节点存在）
    private String tenantOf(String nodeId) {
        return jdbc.queryForObject(
                "SELECT tenant_id FROM data_os.edge_nodes WHERE id = ?", String.class, nodeId);
    }

    private String institutionOf(String nodeId) {
        return jdbc.queryForObject(
                "SELECT institution_id FROM data_os.edge_nodes WHERE id = ?", String.class, nodeId);
    }
}
