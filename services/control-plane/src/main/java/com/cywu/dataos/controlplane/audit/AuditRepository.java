package com.cywu.dataos.controlplane.audit;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AuditRepository {

    private final JdbcTemplate jdbc;

    public AuditRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void record(String actorSubject, String actorName, String tenantId, String institutionId,
                       String method, String path, int statusCode, String action, String traceId,
                       String remoteAddress, Instant createdAt) {
        jdbc.update("""
                INSERT INTO data_os.audit_events
                    (id, actor_subject, actor_name, tenant_id, institution_id, method, path,
                     status_code, action, trace_id, remote_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID().toString(), actorSubject, actorName, tenantId, institutionId,
                method, path, statusCode, action, traceId, remoteAddress, Timestamp.from(createdAt));
    }
}
