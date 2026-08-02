package com.cywu.dataos.controlplane.source;

import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

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
                FROM data_os.sources
                WHERE tenant_id = ? AND institution_id = ?
                ORDER BY created_at DESC
                """, this::map, tenantId, institutionId);
    }

    public Optional<Source> findById(String id) {
        return jdbc.query("""
                SELECT id, tenant_id, institution_id, name, system_type, protocol, status, created_at
                FROM data_os.sources WHERE id = ?
                """, this::map, id).stream().findFirst();
    }

    public Source save(Source source) {
        jdbc.update("""
                INSERT INTO data_os.sources
                    (id, tenant_id, institution_id, name, system_type, protocol, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, source.id(), source.tenantId(), source.institutionId(), source.name(),
                source.systemType(), source.protocol(), source.status(), Timestamp.from(source.createdAt()));
        return source;
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
                resultSet.getTimestamp("created_at").toInstant());
    }
}
