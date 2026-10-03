package com.cywu.dataos.controlplane.source;

import java.sql.Timestamp;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

@Repository
public class SourceRepository {

    private static final TypeReference<Map<String, Object>> CONNECTION_TYPE = new TypeReference<>() {
    };

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public SourceRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public List<Source> findAll(String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, tenant_id, institution_id, name, system_type, protocol, status, created_at
                       , last_checked_at, last_check_message, connection_json
                FROM data_os.sources
                WHERE tenant_id = ? AND institution_id = ?
                ORDER BY created_at DESC
                """, this::map, tenantId, institutionId);
    }

    public java.util.Optional<Source> findById(String id, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, tenant_id, institution_id, name, system_type, protocol, status, created_at,
                       last_checked_at, last_check_message, connection_json
                FROM data_os.sources WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, this::map, id, tenantId, institutionId).stream().findFirst();
    }

    public Source save(Source source) {
        jdbc.update("""
                INSERT INTO data_os.sources
                    (id, tenant_id, institution_id, name, system_type, protocol, status, created_at,
                     last_checked_at, last_check_message, connection_json)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, source.id(), source.tenantId(), source.institutionId(), source.name(),
                source.systemType(), source.protocol(), source.status(), Timestamp.from(source.createdAt()),
                timestamp(source.lastCheckedAt()), source.lastCheckMessage(), connectionJson(source.connection()));
        return source;
    }

    public int updateCheck(String sourceId, String tenantId, String institutionId, String status, String message,
                           java.time.Instant checkedAt) {
        return jdbc.update("""
                UPDATE data_os.sources
                SET status = ?, last_checked_at = ?, last_check_message = ?
                WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, status, Timestamp.from(checkedAt), message, sourceId, tenantId, institutionId);
    }

    public int updateConnection(String sourceId, String tenantId, String institutionId, Map<String, Object> connection) {
        return jdbc.update("""
                UPDATE data_os.sources
                SET connection_json = ?
                WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, connectionJson(connection), sourceId, tenantId, institutionId);
    }

    public boolean exists(String id) {
        Boolean result = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM data_os.sources WHERE id = ?)", Boolean.class, id);
        return Boolean.TRUE.equals(result);
    }

    private Source map(java.sql.ResultSet resultSet, int rowNumber) throws SQLException {
        return new Source(
                resultSet.getString("id"),
                resultSet.getString("tenant_id"),
                resultSet.getString("institution_id"),
                resultSet.getString("name"),
                resultSet.getString("system_type"),
                resultSet.getString("protocol"),
                resultSet.getString("status"),
                resultSet.getTimestamp("created_at").toInstant(),
                resultSet.getTimestamp("last_checked_at") == null ? null : resultSet.getTimestamp("last_checked_at").toInstant(),
                resultSet.getString("last_check_message"),
                readConnection(resultSet.getString("connection_json")));
    }

    private Map<String, Object> readConnection(String json) {
        if (json == null || json.isBlank()) return null;
        try {
            return objectMapper.readValue(json, CONNECTION_TYPE);
        } catch (Exception exception) {
            // 连接配置列只由本仓储写入；损坏即按未登记处理，浏览链路会要求重新登记。
            return null;
        }
    }

    private String connectionJson(Map<String, Object> connection) {
        if (connection == null || connection.isEmpty()) return null;
        try {
            return objectMapper.writeValueAsString(connection);
        } catch (Exception exception) {
            throw new IllegalStateException("数据源连接配置序列化失败", exception);
        }
    }

    private Timestamp timestamp(java.time.Instant value) {
        return value == null ? null : Timestamp.from(value);
    }
}
