package com.cywu.dataos.controlplane.source;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SourceRepository {

    private final JdbcTemplate jdbc;

    public SourceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Source> findAll(String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, tenant_id, institution_id, name, system_type, protocol, status, created_at
                       , last_checked_at, last_check_message
                FROM data_os.sources
                WHERE tenant_id = ? AND institution_id = ?
                ORDER BY created_at DESC
                """, this::map, tenantId, institutionId);
    }

    public Optional<Source> findById(String id, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, tenant_id, institution_id, name, system_type, protocol, status, created_at,
                       last_checked_at, last_check_message
                FROM data_os.sources WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, this::map, id, tenantId, institutionId).stream().findFirst();
    }

    public Source save(Source source) {
        jdbc.update("""
                INSERT INTO data_os.sources
                    (id, tenant_id, institution_id, name, system_type, protocol, status, created_at,
                     last_checked_at, last_check_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, source.id(), source.tenantId(), source.institutionId(), source.name(),
                source.systemType(), source.protocol(), source.status(), Timestamp.from(source.createdAt()),
                timestamp(source.lastCheckedAt()), source.lastCheckMessage());
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

    public boolean exists(String id) {
        Boolean result = jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM data_os.sources WHERE id = ?)", Boolean.class, id);
        return Boolean.TRUE.equals(result);
    }

    private Source map(java.sql.ResultSet resultSet, int rowNumber) throws java.sql.SQLException {
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
                resultSet.getString("last_check_message"));
    }

    private Timestamp timestamp(java.time.Instant value) {
        return value == null ? null : Timestamp.from(value);
    }
}
