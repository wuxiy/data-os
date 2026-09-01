package com.cywu.dataos.controlplane.ai;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 认证审批仓储（data_os.ai_certification_request）。
 */
@Repository
public class AICertificationRepository {

    private final JdbcTemplate jdbc;

    public AICertificationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public AICertificationRequest save(AICertificationRequest request) {
        jdbc.update("""
                INSERT INTO data_os.ai_certification_request
                    (id, product_id, version_sn, readiness_overall, certification, decision,
                     decision_note, requested_by, decided_by, decided_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                request.id(), request.productId(), request.versionSn(), request.readinessOverall(),
                request.certification(), request.decision(), request.decisionNote(),
                request.requestedBy(), request.decidedBy(), timestamp(request.decidedAt()),
                Timestamp.from(request.createdAt()));
        return request;
    }

    public Optional<AICertificationRequest> findById(String id) {
        return jdbc.query(SELECT + " WHERE id = ?", this::map, id).stream().findFirst();
    }

    public List<AICertificationRequest> findByProduct(String productId) {
        return jdbc.query(SELECT + " WHERE product_id = ? ORDER BY created_at DESC", this::map, productId);
    }

    public boolean hasPending(String productId) {
        var found = jdbc.queryForObject("""
                SELECT EXISTS(SELECT 1 FROM data_os.ai_certification_request
                              WHERE product_id = ? AND decision = 'PENDING')
                """, Boolean.class, productId);
        return Boolean.TRUE.equals(found);
    }

    public int decide(String id, String decision, String note, String decidedBy, Instant decidedAt) {
        return jdbc.update("""
                UPDATE data_os.ai_certification_request
                SET decision = ?, decision_note = ?, decided_by = ?, decided_at = ?
                WHERE id = ? AND decision = 'PENDING'
                """, decision, note, decidedBy, Timestamp.from(decidedAt), id);
    }

    /** 当前版本 readiness_json 的 gate 摘要见 {@link ReadinessSnapshot}。 */

    private static final String SELECT = """
            SELECT id, product_id, version_sn, readiness_overall, certification, decision,
                   decision_note, requested_by, decided_by, decided_at, created_at
            FROM data_os.ai_certification_request
            """;

    private AICertificationRequest map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new AICertificationRequest(
                rs.getString("id"), rs.getString("product_id"), rs.getString("version_sn"),
                rs.getDouble("readiness_overall"), rs.getString("certification"),
                rs.getString("decision"), rs.getString("decision_note"),
                rs.getString("requested_by"), rs.getString("decided_by"),
                toInstant(rs.getTimestamp("decided_at")), toInstant(rs.getTimestamp("created_at")));
    }

    private static Instant toInstant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private static Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    public static String newId() {
        return UUID.randomUUID().toString();
    }
}
