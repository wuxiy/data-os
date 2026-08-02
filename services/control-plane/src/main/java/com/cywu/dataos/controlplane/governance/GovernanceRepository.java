package com.cywu.dataos.controlplane.governance;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class GovernanceRepository {

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
        return jdbc.query("""
                SELECT id, title, severity, status, dataset_id, rule_id, owner_department,
                       owner_name, ticket_id, impact, due_at
                FROM data_os.governance_issues
                WHERE tenant_id = ? AND institution_id = ?
                ORDER BY due_at NULLS LAST, severity, id
                """, (resultSet, rowNumber) -> new GovernanceIssue(
                resultSet.getString("id"),
                resultSet.getString("title"),
                resultSet.getString("severity"),
                resultSet.getString("status"),
                resultSet.getString("dataset_id"),
                resultSet.getString("rule_id"),
                resultSet.getString("owner_department"),
                resultSet.getString("owner_name"),
                resultSet.getString("ticket_id"),
                resultSet.getString("impact"),
                resultSet.getTimestamp("due_at") == null ? null : resultSet.getTimestamp("due_at").toInstant()),
                tenantId, institutionId);
    }
}
