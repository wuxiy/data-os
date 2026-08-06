package com.cywu.dataos.controlplane.credential;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class CredentialRepository {

    private final JdbcTemplate jdbc;

    public CredentialRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void save(Credential credential) {
        jdbc.update("""
                INSERT INTO data_os.credentials
                    (id, tenant_id, institution_id, name, provider, metadata_json,
                     secret_ciphertext, status, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, credential.id(), credential.tenantId(), credential.institutionId(), credential.name(),
                credential.provider(), credential.metadataJson(), credential.secretCiphertext(), credential.status(),
                credential.createdBy(), Timestamp.from(credential.createdAt()), Timestamp.from(credential.updatedAt()));
    }

    public List<Credential> findAll(String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, tenant_id, institution_id, name, provider, metadata_json,
                       secret_ciphertext, status, created_by, created_at, updated_at
                FROM data_os.credentials
                WHERE tenant_id = ? AND institution_id = ?
                ORDER BY updated_at DESC
                """, this::map, tenantId, institutionId);
    }

    public Optional<Credential> findById(String id, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, tenant_id, institution_id, name, provider, metadata_json,
                       secret_ciphertext, status, created_by, created_at, updated_at
                FROM data_os.credentials
                WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, this::map, id, tenantId, institutionId).stream().findFirst();
    }

    public int delete(String id, String tenantId, String institutionId) {
        return jdbc.update("DELETE FROM data_os.credentials WHERE id = ? AND tenant_id = ? AND institution_id = ?",
                id, tenantId, institutionId);
    }

    private Credential map(java.sql.ResultSet resultSet, int rowNumber) throws java.sql.SQLException {
        return new Credential(resultSet.getString("id"), resultSet.getString("tenant_id"),
                resultSet.getString("institution_id"), resultSet.getString("name"),
                resultSet.getString("provider"), resultSet.getString("metadata_json"),
                resultSet.getString("secret_ciphertext"), resultSet.getString("status"),
                resultSet.getString("created_by"), resultSet.getTimestamp("created_at").toInstant(),
                resultSet.getTimestamp("updated_at").toInstant());
    }

    public record Credential(String id, String tenantId, String institutionId, String name, String provider,
                             String metadataJson, String secretCiphertext, String status, String createdBy,
                             Instant createdAt, Instant updatedAt) {
    }
}
