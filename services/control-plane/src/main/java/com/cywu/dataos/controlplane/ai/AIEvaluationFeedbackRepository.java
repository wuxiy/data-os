package com.cywu.dataos.controlplane.ai;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 评测反馈仓储（data_os.ai_evaluation_feedback）。
 */
@Repository
public class AIEvaluationFeedbackRepository {

    private static final String SELECT = """
            SELECT id, product_id, version_sn, question, metric, outcome, feedback_type,
                   detail, status, resolution, created_by, resolved_by, resolved_at, created_at
            FROM data_os.ai_evaluation_feedback
            """;

    private final JdbcTemplate jdbc;

    public AIEvaluationFeedbackRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public AIEvaluationFeedback save(AIEvaluationFeedback feedback) {
        jdbc.update("""
                INSERT INTO data_os.ai_evaluation_feedback
                    (id, product_id, version_sn, question, metric, outcome, feedback_type,
                     detail, status, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                feedback.id(), feedback.productId(), feedback.versionSn(), feedback.question(),
                feedback.metric(), feedback.outcome(), feedback.feedbackType(), feedback.detail(),
                feedback.status(), feedback.createdBy(), Timestamp.from(feedback.createdAt()));
        return feedback;
    }

    public Optional<AIEvaluationFeedback> findById(String id) {
        return jdbc.query(SELECT + " WHERE id = ?", this::map, id).stream().findFirst();
    }

    public List<AIEvaluationFeedback> findByProduct(String productId) {
        return jdbc.query(SELECT + " WHERE product_id = ? ORDER BY created_at DESC", this::map, productId);
    }

    public List<AIEvaluationFeedback> findOpen() {
        return jdbc.query(SELECT + " WHERE status = 'CREATED' ORDER BY created_at DESC", this::map);
    }

    public int countOpen() {
        var found = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.ai_evaluation_feedback WHERE status = 'CREATED'",
                Integer.class);
        return found == null ? 0 : found;
    }

    public int resolve(String id, String status, String resolution, String resolvedBy, Instant resolvedAt) {
        return jdbc.update("""
                UPDATE data_os.ai_evaluation_feedback
                SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ?
                WHERE id = ? AND status = 'CREATED'
                """, status, resolution, resolvedBy, Timestamp.from(resolvedAt), id);
    }

    private AIEvaluationFeedback map(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new AIEvaluationFeedback(
                rs.getString("id"), rs.getString("product_id"), rs.getString("version_sn"),
                rs.getString("question"), rs.getString("metric"), rs.getString("outcome"),
                rs.getString("feedback_type"), rs.getString("detail"), rs.getString("status"),
                rs.getString("resolution"), rs.getString("created_by"), rs.getString("resolved_by"),
                toInstant(rs.getTimestamp("resolved_at")), toInstant(rs.getTimestamp("created_at")));
    }

    private static Instant toInstant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    public static String newId() {
        return UUID.randomUUID().toString();
    }
}
