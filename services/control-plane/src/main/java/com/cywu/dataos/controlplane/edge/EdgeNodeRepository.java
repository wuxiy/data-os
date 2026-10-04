package com.cywu.dataos.controlplane.edge;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 前置机节点台账（V26）。 */
@Repository
public class EdgeNodeRepository {

    private static final TypeReference<Map<String, Object>> CONFIG_TYPE = new TypeReference<>() {
    };

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public EdgeNodeRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    private static final String SELECT = """
            SELECT id, tenant_id, institution_id, name, group_name, site, host, port, version,
                   last_probe_at, last_probe_ok, last_probe_message, config_json, created_at, updated_at
            FROM data_os.edge_nodes
            """;

    public List<EdgeNode> findAll(String tenantId, String institutionId) {
        return jdbc.query(SELECT + """
                        WHERE tenant_id = ? AND institution_id = ?
                        ORDER BY created_at DESC
                        """, this::map, tenantId, institutionId);
    }

    public Optional<EdgeNode> findById(String id, String tenantId, String institutionId) {
        return jdbc.query(SELECT + """
                        WHERE id = ? AND tenant_id = ? AND institution_id = ?
                        """, this::map, id, tenantId, institutionId).stream().findFirst();
    }

    public void save(EdgeNode node) {
        jdbc.update("DELETE FROM data_os.edge_nodes WHERE id = ?", node.id());
        jdbc.update("""
                INSERT INTO data_os.edge_nodes
                    (id, tenant_id, institution_id, name, group_name, site, host, port, version,
                     last_probe_at, last_probe_ok, last_probe_message, config_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, node.id(), node.tenantId(), node.institutionId(), node.name(), node.groupName(),
                node.site(), node.host(), node.port(), node.version(),
                timestamp(node.lastProbeAt()), node.lastProbeOk(), node.lastProbeMessage(),
                configJson(node.config()), Timestamp.from(node.createdAt()), Timestamp.from(node.updatedAt()));
    }

    public int updateProbe(String id, String tenantId, String institutionId,
                           boolean ok, String message, Instant probedAt) {
        return jdbc.update("""
                UPDATE data_os.edge_nodes
                SET last_probe_at = ?, last_probe_ok = ?, last_probe_message = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, Timestamp.from(probedAt), ok, message, id, tenantId, institutionId);
    }

    public int delete(String id, String tenantId, String institutionId) {
        return jdbc.update("""
                DELETE FROM data_os.edge_nodes
                WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, id, tenantId, institutionId);
    }

    private EdgeNode map(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        var node = new EdgeNode(
                rs.getString("id"), rs.getString("tenant_id"), rs.getString("institution_id"),
                rs.getString("name"), rs.getString("group_name"), rs.getString("site"),
                rs.getString("host"), rs.getInt("port"), rs.getString("version"),
                instant(rs.getTimestamp("last_probe_at")),
                (Boolean) rs.getObject("last_probe_ok"),
                rs.getString("last_probe_message"),
                readConfig(rs.getString("config_json")),
                instant(rs.getTimestamp("created_at")), instant(rs.getTimestamp("updated_at")), null);
        return new EdgeNode(node.id(), node.tenantId(), node.institutionId(), node.name(), node.groupName(),
                node.site(), node.host(), node.port(), node.version(), node.lastProbeAt(), node.lastProbeOk(),
                node.lastProbeMessage(), node.config(), node.createdAt(), node.updatedAt(), node.derivedState());
    }

    private Map<String, Object> readConfig(String json) {
        if (json == null || json.isBlank()) return Map.of();
        try {
            return objectMapper.readValue(json, CONFIG_TYPE);
        } catch (Exception exception) {
            return Map.of();
        }
    }

    private String configJson(Map<String, Object> config) {
        if (config == null || config.isEmpty()) return null;
        try {
            return objectMapper.writeValueAsString(config);
        } catch (Exception exception) {
            throw new IllegalStateException("前置机参数序列化失败", exception);
        }
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }
}
