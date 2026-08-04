package com.cywu.dataos.controlplane.governance;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class GovernanceRepository {

    private static final String ISSUE_SELECT = """
            SELECT id, title, severity, status, dataset_id, rule_id, owner_department,
                   owner_name, ticket_id, impact, due_at, object_label, processing_note,
                   updated_at, last_action_at, last_action
            FROM data_os.governance_issues
            """;

    private final JdbcTemplate jdbc;

    public GovernanceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Metric> findMetrics(String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT metric_key, label, metric_value, unit, target, detail, tone
                FROM data_os.governance_metrics
                WHERE tenant_id = ? AND institution_id = ?
                ORDER BY display_order
                """, (resultSet, rowNumber) -> new Metric(
                resultSet.getString("metric_key"),
                resultSet.getString("label"),
                resultSet.getBigDecimal("metric_value"),
                resultSet.getString("unit"),
                resultSet.getBigDecimal("target"),
                resultSet.getString("detail"),
                resultSet.getString("tone")), tenantId, institutionId);
    }

    public List<GovernanceIssue> findIssues(String tenantId, String institutionId) {
        return findIssues(tenantId, institutionId, null, null);
    }

    public List<GovernanceIssue> findIssues(String tenantId, String institutionId, String status, String query) {
        var sql = new StringBuilder(ISSUE_SELECT)
                .append(" WHERE tenant_id = ? AND institution_id = ?");
        var args = new ArrayList<Object>();
        args.add(tenantId);
        args.add(institutionId);
        if (status != null && !status.isBlank()) {
            sql.append(" AND status = ?");
            args.add(status.trim().toUpperCase());
        }
        if (query != null && !query.isBlank()) {
            sql.append(" AND (LOWER(title) LIKE LOWER(?) OR LOWER(owner_department) LIKE LOWER(?)");
            sql.append(" OR LOWER(dataset_id) LIKE LOWER(?) OR LOWER(rule_id) LIKE LOWER(?))");
            var pattern = "%" + query.trim() + "%";
            args.add(pattern);
            args.add(pattern);
            args.add(pattern);
            args.add(pattern);
        }
        sql.append(" ORDER BY due_at NULLS LAST, severity, id");
        return jdbc.query(sql.toString(), this::mapIssue, args.toArray());
    }

    public Optional<GovernanceIssue> findIssue(String id, String tenantId, String institutionId) {
        var items = jdbc.query(ISSUE_SELECT + " WHERE id = ? AND tenant_id = ? AND institution_id = ?",
                this::mapIssue, id, tenantId, institutionId);
        return items.stream().findFirst();
    }

    public List<GovernanceIssueEvent> findEvents(String issueId) {
        return jdbc.query("""
                SELECT id, issue_id, event_type, note, actor, created_at
                FROM data_os.governance_issue_events
                WHERE issue_id = ?
                ORDER BY created_at DESC
                """, (resultSet, rowNumber) -> new GovernanceIssueEvent(
                resultSet.getString("id"),
                resultSet.getString("issue_id"),
                resultSet.getString("event_type"),
                resultSet.getString("note"),
                resultSet.getString("actor"),
                resultSet.getTimestamp("created_at").toInstant()), issueId);
    }

    public int updateWorkflow(String id, String tenantId, String institutionId, String status,
                              String note, Instant actionAt, String action) {
        return jdbc.update("""
                UPDATE data_os.governance_issues
                SET status = ?, processing_note = ?, updated_at = ?, last_action_at = ?, last_action = ?
                WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, status, note, timestamp(actionAt), timestamp(actionAt), action,
                id, tenantId, institutionId);
    }

    public void insertEvent(String issueId, String eventType, String note, String actor, Instant createdAt) {
        jdbc.update("""
                INSERT INTO data_os.governance_issue_events
                    (id, issue_id, event_type, note, actor, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID().toString(), issueId, eventType, note, actor, timestamp(createdAt));
    }

    private GovernanceIssue mapIssue(java.sql.ResultSet resultSet, int rowNumber) throws java.sql.SQLException {
        var datasetId = resultSet.getString("dataset_id");
        var objectLabel = resultSet.getString("object_label");
        return new GovernanceIssue(
                resultSet.getString("id"),
                resultSet.getString("title"),
                resultSet.getString("severity"),
                resultSet.getString("status"),
                datasetId,
                resultSet.getString("rule_id"),
                resultSet.getString("owner_department"),
                resultSet.getString("owner_name"),
                resultSet.getString("ticket_id"),
                resultSet.getString("impact"),
                instant(resultSet.getTimestamp("due_at")),
                objectLabel == null || objectLabel.isBlank() ? datasetId : objectLabel,
                resultSet.getString("processing_note"),
                instant(resultSet.getTimestamp("updated_at")),
                instant(resultSet.getTimestamp("last_action_at")),
                resultSet.getString("last_action"));
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }
}
