package com.cywu.dataos.controlplane.governance;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

/**
 * 治理问题聚合的仓储：问题、事件与 SLA 扫描（SLA 即问题表 due_at 的
 * 扫描）。质量侧终态效果会经此推进问题工作流——两侧共用一个聚合。
 */
@Repository
public class IssueRepository {

    private static final String ISSUE_SELECT = """
            SELECT id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id, owner_department,
                   owner_id, owner_name, ticket_id, impact, due_at, object_label, processing_note,
                   updated_at, last_action_at, last_action, sla_overdue_at
            FROM data_os.governance_issues
            """;

    private final JdbcTemplate jdbc;

    public IssueRepository(JdbcTemplate jdbc) {
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
            args.add(status.trim().toUpperCase(Locale.ROOT));
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

    public Optional<GovernanceIssue> findIssueBySourceKey(String sourceKey, String tenantId, String institutionId) {
        return jdbc.query(ISSUE_SELECT + " WHERE source_key = ? AND tenant_id = ? AND institution_id = ?",
                this::mapIssue, sourceKey, tenantId, institutionId).stream().findFirst();
    }

    @Transactional(propagation = Propagation.NESTED)
    public int insertQualityFindingIssue(String id, String tenantId, String institutionId,
                                         com.cywu.dataos.controlplane.quality.QualityFindingRequest request,
                                         String sourceKey, String sourceSystem, String severity, Instant now) {
        return jdbc.update("""
                INSERT INTO data_os.governance_issues
                    (id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id,
                     owner_department, owner_id, owner_name, ticket_id, impact, due_at, object_label,
                     processing_note, updated_at, last_action_at, last_action, source_key, source_system)
                VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUALITY_FINDING_DETECTED', ?, ?)
                """, id, tenantId, institutionId, request.title().trim(), severity, request.datasetId().trim(),
                request.ruleId().trim(), request.ownerDepartment().trim(), request.ownerId().trim(),
                request.ownerName().trim(), request.ticketId().trim(), request.impact().trim(),
                timestamp(request.dueAt()), request.objectLabel().trim(), request.message().trim(), timestamp(now),
                timestamp(now), sourceKey, sourceSystem);
    }

    public int updateIssueFromQualityFinding(String id, String tenantId, String institutionId,
                                             String status, String note, String action, Instant actionAt) {
        return jdbc.update("""
                UPDATE data_os.governance_issues
                SET status = ?, processing_note = ?, updated_at = ?, last_action_at = ?, last_action = ?
                WHERE id = ? AND tenant_id = ? AND institution_id = ?
                """, status, safe(note), timestamp(actionAt), timestamp(actionAt), action,
                id, tenantId, institutionId);
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
                WHERE id = ? AND tenant_id = ? AND institution_id = ? AND status <> 'RECHECKING'
                """, status, note, timestamp(actionAt), timestamp(actionAt), action,
                id, tenantId, institutionId);
    }

    public String insertEvent(String issueId, String eventType, String note, String actor, Instant createdAt) {
        var id = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO data_os.governance_issue_events
                    (id, issue_id, event_type, note, actor, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, id, issueId, eventType, note, actor, timestamp(createdAt));
        return id;
    }

    public int updateIssueAfterQualityResult(String issueId, String tenantId, String institutionId,
                                             String status, String note, String action, Instant actionAt) {
        return jdbc.update("""
                UPDATE data_os.governance_issues
                SET status = ?, processing_note = ?, updated_at = ?, last_action_at = ?, last_action = ?
                WHERE id = ? AND tenant_id = ? AND institution_id = ? AND status = 'RECHECKING'
                """, status, safe(note), timestamp(actionAt), timestamp(actionAt), action,
                issueId, tenantId, institutionId);
    }

    public List<GovernanceIssue> findSlaCandidates(String tenantId, String institutionId, Instant now) {
        return jdbc.query(ISSUE_SELECT + " WHERE tenant_id = ? AND institution_id = ?"
                        + " AND due_at IS NOT NULL AND due_at < ? AND sla_overdue_at IS NULL"
                        + " AND status <> 'CLOSED' ORDER BY due_at LIMIT 100",
                this::mapIssue, tenantId, institutionId, timestamp(now));
    }

    public List<IssueScope> findSlaScopes(Instant now) {
        return jdbc.query("""
                SELECT DISTINCT tenant_id, institution_id
                FROM data_os.governance_issues
                WHERE due_at IS NOT NULL AND due_at < ? AND sla_overdue_at IS NULL AND status <> 'CLOSED'
                """, (resultSet, rowNumber) -> new IssueScope(
                resultSet.getString("tenant_id"), resultSet.getString("institution_id")), timestamp(now));
    }

    public int markSlaOverdue(String issueId, String tenantId, String institutionId, Instant now) {
        return jdbc.update("""
                UPDATE data_os.governance_issues
                SET sla_overdue_at = ?, status = CASE WHEN status = 'RECHECKING' THEN status ELSE 'OVERDUE' END,
                    updated_at = ?, last_action_at = ?, last_action = 'SLA_OVERDUE'
                WHERE id = ? AND tenant_id = ? AND institution_id = ?
                  AND due_at IS NOT NULL AND due_at < ? AND sla_overdue_at IS NULL AND status <> 'CLOSED'
                """, timestamp(now), timestamp(now), timestamp(now), issueId, tenantId, institutionId, timestamp(now));
    }

    private GovernanceIssue mapIssue(java.sql.ResultSet resultSet, int rowNumber) throws java.sql.SQLException {
        var datasetId = resultSet.getString("dataset_id");
        var objectLabel = resultSet.getString("object_label");
        return new GovernanceIssue(
                resultSet.getString("id"),
                resultSet.getString("tenant_id"),
                resultSet.getString("institution_id"),
                resultSet.getString("title"),
                resultSet.getString("severity"),
                resultSet.getString("status"),
                datasetId,
                resultSet.getString("rule_id"),
                resultSet.getString("owner_department"),
                resultSet.getString("owner_id"),
                resultSet.getString("owner_name"),
                resultSet.getString("ticket_id"),
                resultSet.getString("impact"),
                instant(resultSet.getTimestamp("due_at")),
                objectLabel == null || objectLabel.isBlank() ? datasetId : objectLabel,
                resultSet.getString("processing_note"),
                instant(resultSet.getTimestamp("updated_at")),
                instant(resultSet.getTimestamp("last_action_at")),
                resultSet.getString("last_action"),
                instant(resultSet.getTimestamp("sla_overdue_at")));
    }

    private String safe(String value) {
        if (value == null || value.isBlank()) return null;
        return value.length() > 1000 ? value.substring(0, 1000) : value;
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    public record IssueScope(String tenantId, String institutionId) {
    }
}
