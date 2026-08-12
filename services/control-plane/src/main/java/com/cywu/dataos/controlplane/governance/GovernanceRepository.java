package com.cywu.dataos.controlplane.governance;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.cywu.dataos.controlplane.quality.QualityRuleRun;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class GovernanceRepository {

    private static final String ISSUE_SELECT = """
            SELECT id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id, owner_department,
                   owner_id, owner_name, ticket_id, impact, due_at, object_label, processing_note,
                   updated_at, last_action_at, last_action, sla_overdue_at
            FROM data_os.governance_issues
            """;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public GovernanceRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
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

    @Transactional(propagation = Propagation.REQUIRES_NEW)
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

    public QualityRuleRun createQualityRun(String issueId, String tenantId, String institutionId,
                                           String ruleId, String datasetId, String executor,
                                           String executionBatchId, Instant submittedAt) {
        var id = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO data_os.quality_rule_runs
                    (id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor,
                     status, execution_batch_id, submitted_at, next_poll_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTING', ?, ?, ?, ?)
                """, id, issueId, tenantId, institutionId, ruleId, datasetId, executor,
                executionBatchId, timestamp(submittedAt), timestamp(submittedAt), timestamp(submittedAt));
        return findQualityRun(id, issueId, tenantId, institutionId)
                .orElseThrow(() -> new IllegalStateException("质量复检执行批次创建失败"));
    }

    public Optional<QualityRuleRun> findQualityRun(String runId, String issueId,
                                                   String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status, external_id,
                       execution_batch_id, passed, result_message, sample_evidence_json,
                       artifact_uri, reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at, attempt_count, next_poll_at,
                       last_error, updated_at
                FROM data_os.quality_rule_runs
                WHERE id = ? AND issue_id = ? AND tenant_id = ? AND institution_id = ?
                """, this::mapQualityRun, runId, issueId, tenantId, institutionId).stream().findFirst();
    }

    public Optional<QualityRuleRun> findQualityRunByExternal(String executor, String externalId) {
        return jdbc.query("""
                SELECT id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status, external_id,
                       execution_batch_id, passed, result_message, sample_evidence_json,
                       artifact_uri, reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at, attempt_count, next_poll_at,
                       last_error, updated_at
                FROM data_os.quality_rule_runs
                WHERE executor = ? AND external_id = ?
                """, this::mapQualityRun, executor, externalId).stream().findFirst();
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public QualityFindingRunWrite recordQualityFindingRun(String issueId, String tenantId, String institutionId,
                                                          com.cywu.dataos.controlplane.quality.QualityFindingRequest request,
                                                          String executor, String externalId, String status, Instant now) {
        var id = UUID.randomUUID().toString();
        jdbc.update("""
                    INSERT INTO data_os.quality_rule_runs
                        (id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status,
                         external_id, execution_batch_id, passed, result_message, sample_evidence_json,
                         sample_evidence_count, submitted_at, started_at, finished_at, attempt_count, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    """, id, issueId, tenantId, institutionId, request.ruleId().trim(), request.datasetId().trim(),
                    executor, status, externalId, request.executionBatchId().trim(), request.passed(),
                    safe(request.message()), evidenceJson(request.sampleEvidence()),
                    request.sampleEvidence() == null ? 0 : request.sampleEvidence().size(), timestamp(now),
                    timestamp(now), timestamp(now), timestamp(now));
        var run = issueId == null
                ? findQualityRunByExternal(executor, externalId)
                : findQualityRun(id, issueId, tenantId, institutionId);
        var persisted = run.orElseThrow(() -> new IllegalStateException("质量结果执行批次写入失败"));
        return new QualityFindingRunWrite(persisted, true);
    }

    public record QualityFindingRunWrite(QualityRuleRun run, boolean inserted) {
    }

    public Optional<QualityRuleRun> findLatestQualityRun(String issueId, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status, external_id,
                       execution_batch_id, passed, result_message, sample_evidence_json,
                       artifact_uri, reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at, attempt_count, next_poll_at,
                       last_error, updated_at
                FROM data_os.quality_rule_runs
                WHERE issue_id = ? AND tenant_id = ? AND institution_id = ?
                ORDER BY submitted_at DESC
                LIMIT 1
                """, this::mapQualityRun, issueId, tenantId, institutionId).stream().findFirst();
    }

    public List<QualityRuleRun> findQualityRuns(String issueId, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status, external_id,
                       execution_batch_id, passed, result_message, sample_evidence_json,
                       artifact_uri, reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at, attempt_count, next_poll_at,
                       last_error, updated_at
                FROM data_os.quality_rule_runs
                WHERE issue_id = ? AND tenant_id = ? AND institution_id = ?
                ORDER BY submitted_at DESC
                LIMIT 20
                """, this::mapQualityRun, issueId, tenantId, institutionId);
    }

    public List<QualityRuleRun> findQualitySyncCandidates(Instant now) {
        return jdbc.query("""
                SELECT id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status, external_id,
                       execution_batch_id, passed, result_message, sample_evidence_json,
                       artifact_uri, reconciliation_status, reconciliation_message,
                       submitted_at, started_at, finished_at, attempt_count, next_poll_at,
                       last_error, updated_at
                FROM data_os.quality_rule_runs
                WHERE status IN ('SUBMITTING', 'SUBMITTED', 'RUNNING', 'UNKNOWN')
                  AND (reconciliation_status IS NULL OR reconciliation_status <> 'MANUAL_REQUIRED')
                  AND (status_lease_until IS NULL OR status_lease_until <= ?)
                  AND ((status = 'SUBMITTING'
                        AND (next_poll_at IS NULL OR next_poll_at <= ?)
                        AND (submit_lease_until IS NULL OR submit_lease_until <= ?))
                    OR (status <> 'SUBMITTING'
                        AND (next_poll_at IS NULL OR next_poll_at <= ?)))
                ORDER BY submitted_at
                LIMIT 100
                """, this::mapQualityRun, timestamp(now), timestamp(now), timestamp(now), timestamp(now));
    }

    public int claimQualityRunForStatus(String runId, String workerId, Instant leaseUntil, Instant now,
                                        String expectedStatus, String expectedExternalId) {
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET status_lease_until = ?, status_lease_by = ?, updated_at = ?
                WHERE id = ? AND status = ?
                  AND (external_id = ? OR (external_id IS NULL AND ? IS NULL))
                  AND (status_lease_until IS NULL OR status_lease_until <= ?)
                """, timestamp(leaseUntil), workerId, timestamp(now), runId, expectedStatus,
                expectedExternalId, expectedExternalId, timestamp(now));
    }

    public int claimQualityRunForSubmission(String runId, String workerId,
                                            Instant leaseUntil, Instant now) {
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET submit_lease_until = ?, submit_lease_by = ?, updated_at = ?
                WHERE id = ? AND status = 'SUBMITTING'
                  AND (next_poll_at IS NULL OR next_poll_at <= ?)
                  AND (submit_lease_until IS NULL OR submit_lease_until <= ?)
                """, timestamp(leaseUntil), workerId, timestamp(now), runId,
                timestamp(now), timestamp(now));
    }

    public int markQualityRunSubmitted(String runId, String workerId, String externalId,
                                       String message, Instant nextPollAt) {
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET status = 'SUBMITTED', external_id = ?, result_message = ?,
                    attempt_count = attempt_count + 1, next_poll_at = ?, last_error = NULL,
                    submit_lease_until = NULL, submit_lease_by = NULL,
                    status_lease_until = NULL, status_lease_by = NULL,
                    updated_at = ?
                WHERE id = ? AND status = 'SUBMITTING' AND submit_lease_by = ?
                """, externalId, safe(message), timestamp(nextPollAt), timestamp(Instant.now()), runId, workerId);
    }

    public int markQualityRunSubmissionError(String runId, String workerId, String lastError,
                                              Instant nextPollAt) {
        return markQualityRunSubmissionError(runId, workerId, lastError, nextPollAt, null);
    }

    public int markQualityRunSubmissionError(String runId, String workerId, String lastError,
                                              Instant nextPollAt, String terminalStatus) {
        var status = terminalStatus == null || terminalStatus.isBlank() ? null : normalizeRunStatus(terminalStatus);
        if (status == null) {
            return jdbc.update("""
                    UPDATE data_os.quality_rule_runs
                    SET attempt_count = attempt_count + 1, last_error = ?, next_poll_at = ?,
                        submit_lease_until = NULL, submit_lease_by = NULL,
                        status_lease_until = NULL, status_lease_by = NULL, updated_at = ?
                    WHERE id = ? AND status = 'SUBMITTING' AND submit_lease_by = ?
                    """, safe(lastError), timestamp(nextPollAt), timestamp(Instant.now()), runId, workerId);
        }
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET status = ?, result_message = ?, last_error = ?, attempt_count = attempt_count + 1,
                    finished_at = ?, next_poll_at = NULL, submit_lease_until = NULL, submit_lease_by = NULL,
                    status_lease_until = NULL, status_lease_by = NULL,
                    updated_at = ?
                WHERE id = ? AND status = 'SUBMITTING' AND submit_lease_by = ?
                """, status, safe(lastError), safe(lastError), timestamp(Instant.now()), timestamp(Instant.now()),
                runId, workerId);
    }

    public int markOrphanQualityRunSubmissionError(String runId, String lastError, Instant now) {
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET status = 'SUBMIT_FAILED', result_message = ?, last_error = ?, attempt_count = attempt_count + 1,
                    finished_at = ?, next_poll_at = NULL, submit_lease_until = NULL, submit_lease_by = NULL,
                    updated_at = ?
                WHERE id = ? AND status = 'SUBMITTING'
                  AND (submit_lease_until IS NULL OR submit_lease_until <= ?)
                """, safe(lastError), safe(lastError), timestamp(now), timestamp(now), runId, timestamp(now));
    }

    public int updateQualityRunStatus(String runId, String status, Boolean passed,
                                      String executionBatchId, String message,
                                      List<Map<String, Object>> sampleEvidence,
                                      String artifactUri,
                                      Instant startedAt, Instant finishedAt,
                                      Instant nextPollAt, String lastError,
                                      String expectedStatus, String expectedExternalId,
                                      String statusWorkerId) {
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET status = ?, passed = ?, execution_batch_id = COALESCE(NULLIF(?, ''), execution_batch_id),
                    result_message = ?, sample_evidence_json = ?, sample_evidence_count = ?, artifact_uri = ?,
                    reconciliation_status = CASE WHEN ? = 'UNKNOWN' THEN 'MANUAL_REQUIRED' ELSE NULL END,
                    reconciliation_message = CASE WHEN ? = 'UNKNOWN' THEN ? ELSE NULL END,
                    started_at = COALESCE(?, started_at), finished_at = ?,
                    attempt_count = attempt_count + 1, next_poll_at = ?, last_error = ?,
                    status_lease_until = NULL, status_lease_by = NULL, updated_at = ?
                WHERE id = ? AND status IN ('SUBMITTED', 'RUNNING', 'UNKNOWN')
                  AND status = ?
                  AND (external_id = ? OR (external_id IS NULL AND ? IS NULL))
                  AND status_lease_by = ?
                """, normalizeRunStatus(status), passed,
                executionBatchId == null ? "" : executionBatchId, safe(message), evidenceJson(sampleEvidence),
                sampleEvidence == null ? 0 : sampleEvidence.size(), safe(artifactUri), normalizeRunStatus(status),
                normalizeRunStatus(status), safe(message), timestamp(startedAt), timestamp(finishedAt),
                "UNKNOWN".equals(normalizeRunStatus(status)) ? null : timestamp(nextPollAt), safe(lastError),
                timestamp(Instant.now()), runId, expectedStatus, expectedExternalId, expectedExternalId,
                statusWorkerId);
    }

    public int reopenQualityRunForReconciliation(String runId) {
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET reconciliation_status = NULL, reconciliation_message = NULL,
                    next_poll_at = CURRENT_TIMESTAMP, last_error = NULL,
                    status_lease_until = NULL, status_lease_by = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'UNKNOWN' AND external_id IS NOT NULL
                  AND reconciliation_status = 'MANUAL_REQUIRED'
                """, runId);
    }

    public int confirmQualityRunAbsent(String runId, String message) {
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET status = 'SUBMIT_FAILED', passed = FALSE, result_message = ?, last_error = ?,
                    reconciliation_status = 'CONFIRMED_ABSENT', reconciliation_message = ?,
                    finished_at = CURRENT_TIMESTAMP, next_poll_at = NULL,
                    submit_lease_until = NULL, submit_lease_by = NULL,
                    status_lease_until = NULL, status_lease_by = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'UNKNOWN' AND external_id IS NOT NULL
                  AND reconciliation_status = 'MANUAL_REQUIRED'
                """, safe(message), safe(message), safe(message), runId);
    }

    public int markQualityRunError(String runId, String lastError, Instant nextPollAt, String terminalStatus,
                                   String expectedStatus, String expectedExternalId, String statusWorkerId) {
        var status = terminalStatus == null || terminalStatus.isBlank() ? null : normalizeRunStatus(terminalStatus);
        if (status == null) {
            return jdbc.update("""
                    UPDATE data_os.quality_rule_runs
                    SET attempt_count = attempt_count + 1, last_error = ?, next_poll_at = ?,
                        submit_lease_until = NULL, submit_lease_by = NULL,
                        status_lease_until = NULL, status_lease_by = NULL, updated_at = ?
                    WHERE id = ? AND status IN ('SUBMITTING', 'SUBMITTED', 'RUNNING', 'UNKNOWN')
                      AND status = ?
                      AND (external_id = ? OR (external_id IS NULL AND ? IS NULL))
                      AND status_lease_by = ?
                    """, safe(lastError), timestamp(nextPollAt), timestamp(Instant.now()), runId,
                    expectedStatus, expectedExternalId, expectedExternalId, statusWorkerId);
        }
        return jdbc.update("""
                UPDATE data_os.quality_rule_runs
                SET status = ?, result_message = ?, last_error = ?, attempt_count = attempt_count + 1,
                    finished_at = ?, next_poll_at = NULL, submit_lease_until = NULL, submit_lease_by = NULL,
                    status_lease_until = NULL, status_lease_by = NULL,
                    updated_at = ?
                WHERE id = ? AND status IN ('SUBMITTING', 'SUBMITTED', 'RUNNING', 'UNKNOWN')
                  AND status = ?
                  AND (external_id = ? OR (external_id IS NULL AND ? IS NULL))
                  AND status_lease_by = ?
                """, status, safe(lastError), safe(lastError), timestamp(Instant.now()), timestamp(Instant.now()), runId,
                expectedStatus, expectedExternalId, expectedExternalId, statusWorkerId);
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

    public GovernanceNotification enqueueNotification(String issueId, String eventId, String channel,
                                                       String tenantId, String institutionId, String recipient,
                                                       String recipientId, String subject, String body,
                                                       String idempotencyKey, Instant now) {
        var existing = findNotificationByKey(idempotencyKey);
        if (existing.isPresent()) return existing.get();
        var id = UUID.randomUUID().toString();
        try {
            jdbc.update("""
                    INSERT INTO data_os.governance_notifications
                        (id, issue_id, event_id, tenant_id, institution_id, channel, recipient, recipient_id, subject, body, status,
                         idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0, ?, ?, ?)
                    """, id, issueId, eventId, tenantId, institutionId, channel, recipient, recipientId, subject, body,
                    idempotencyKey, timestamp(now), timestamp(now), timestamp(now));
        } catch (org.springframework.dao.DuplicateKeyException duplicate) {
            return findNotificationByKey(idempotencyKey).orElseThrow(() -> duplicate);
        }
        return findNotificationById(id).orElseThrow(() -> new IllegalStateException("通知记录创建失败"));
    }

    public List<GovernanceNotification> findNotifications(String issueId) {
        return jdbc.query(notificationSelect() + " WHERE issue_id = ? ORDER BY created_at DESC",
                this::mapNotification, issueId);
    }

    public List<GovernanceNotification> claimPendingNotifications(Instant now, Instant lockedUntil, String workerId) {
        var candidates = jdbc.query(notificationSelect()
                        + " WHERE ((status IN ('PENDING', 'FAILED')"
                        + " AND (next_attempt_at IS NULL OR next_attempt_at <= ?))"
                        + " OR (status = 'SENDING' AND (locked_until IS NULL OR locked_until <= ?)))"
                        + " ORDER BY created_at LIMIT 100",
                this::mapNotification, timestamp(now), timestamp(now));
        var claimed = new ArrayList<GovernanceNotification>();
        for (var candidate : candidates) {
            var updated = jdbc.update("""
                    UPDATE data_os.governance_notifications
                    SET status = 'SENDING', locked_until = ?, locked_by = ?, updated_at = ?
                    WHERE id = ?
                      AND ((status IN ('PENDING', 'FAILED')
                           AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
                       OR (status = 'SENDING' AND (locked_until IS NULL OR locked_until <= ?)))
                    """, timestamp(lockedUntil), workerId, timestamp(now), candidate.id(),
                    timestamp(now), timestamp(now));
            if (updated == 1) findNotificationById(candidate.id()).ifPresent(claimed::add);
        }
        return claimed;
    }

    public int markNotificationSent(String id, String workerId, Instant sentAt) {
        return jdbc.update("""
                UPDATE data_os.governance_notifications
                SET status = 'SENT', attempt_count = attempt_count + 1, sent_at = ?,
                    last_error = NULL, next_attempt_at = NULL, locked_until = NULL, locked_by = NULL,
                    updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, timestamp(sentAt), timestamp(sentAt), id, workerId);
    }

    public int markNotificationSkipped(String id, String workerId, String message, Instant at) {
        return jdbc.update("""
                UPDATE data_os.governance_notifications
                SET status = 'SKIPPED', attempt_count = attempt_count + 1, last_error = ?,
                    next_attempt_at = NULL, locked_until = NULL, locked_by = NULL, updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, safe(message), timestamp(at), id, workerId);
    }

    public int markNotificationFailed(String id, String workerId, String message,
                                       Instant nextAttemptAt, Instant at) {
        return jdbc.update("""
                UPDATE data_os.governance_notifications
                SET status = 'FAILED', attempt_count = attempt_count + 1, last_error = ?,
                    next_attempt_at = ?, locked_until = NULL, locked_by = NULL, updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, safe(message), timestamp(nextAttemptAt), timestamp(at), id, workerId);
    }

    private Optional<GovernanceNotification> findNotificationByKey(String key) {
        return jdbc.query(notificationSelect() + " WHERE idempotency_key = ?",
                this::mapNotification, key).stream().findFirst();
    }

    public Optional<GovernanceNotification> findNotificationByIdempotencyKey(String key) {
        if (key == null || key.isBlank()) return Optional.empty();
        return findNotificationByKey(key);
    }

    private Optional<GovernanceNotification> findNotificationById(String id) {
        return jdbc.query(notificationSelect() + " WHERE id = ?", this::mapNotification, id).stream().findFirst();
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

    private QualityRuleRun mapQualityRun(java.sql.ResultSet resultSet, int rowNumber) throws java.sql.SQLException {
        return new QualityRuleRun(
                resultSet.getString("id"), resultSet.getString("issue_id"), resultSet.getString("tenant_id"),
                resultSet.getString("institution_id"), resultSet.getString("rule_id"), resultSet.getString("dataset_id"),
                resultSet.getString("executor"), resultSet.getString("status"),
                resultSet.getString("external_id"), resultSet.getString("execution_batch_id"),
                (Boolean) resultSet.getObject("passed"), resultSet.getString("result_message"),
                evidenceList(resultSet.getString("sample_evidence_json")), resultSet.getString("artifact_uri"),
                resultSet.getString("reconciliation_status"), resultSet.getString("reconciliation_message"),
                instant(resultSet.getTimestamp("submitted_at")), instant(resultSet.getTimestamp("started_at")),
                instant(resultSet.getTimestamp("finished_at")), resultSet.getInt("attempt_count"),
                instant(resultSet.getTimestamp("next_poll_at")), resultSet.getString("last_error"),
                instant(resultSet.getTimestamp("updated_at")));
    }

    private GovernanceNotification mapNotification(java.sql.ResultSet resultSet, int rowNumber)
            throws java.sql.SQLException {
        return new GovernanceNotification(
                resultSet.getString("id"), resultSet.getString("issue_id"), resultSet.getString("event_id"),
                resultSet.getString("tenant_id"), resultSet.getString("institution_id"),
                resultSet.getString("channel"), resultSet.getString("recipient"), resultSet.getString("recipient_id"),
                resultSet.getString("subject"),
                resultSet.getString("body"), resultSet.getString("status"), resultSet.getString("idempotency_key"),
                resultSet.getInt("attempt_count"), resultSet.getString("last_error"),
                instant(resultSet.getTimestamp("next_attempt_at")), instant(resultSet.getTimestamp("locked_until")),
                resultSet.getString("locked_by"), instant(resultSet.getTimestamp("sent_at")),
                instant(resultSet.getTimestamp("created_at")), instant(resultSet.getTimestamp("updated_at")));
    }

    private String notificationSelect() {
        return """
                SELECT id, issue_id, event_id, tenant_id, institution_id, channel, recipient, recipient_id, subject, body, status,
                       idempotency_key, attempt_count, last_error, next_attempt_at, locked_until, locked_by, sent_at,
                       created_at, updated_at
                FROM data_os.governance_notifications
                """;
    }

    private List<Map<String, Object>> evidenceList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, objectMapper.getTypeFactory()
                    .constructCollectionType(List.class, Map.class));
        } catch (JsonProcessingException exception) {
            return List.of(Map.of("raw", json));
        }
    }

    private String evidenceJson(List<Map<String, Object>> evidence) {
        if (evidence == null || evidence.isEmpty()) return "[]";
        try {
            return objectMapper.writeValueAsString(evidence);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("质量复检样本证据无法序列化", exception);
        }
    }

    private String normalizeRunStatus(String value) {
        var normalized = value == null ? "UNKNOWN" : value.trim().toUpperCase(Locale.ROOT);
        if (!List.of("SUBMITTED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN", "SUBMIT_FAILED")
                .contains(normalized)) {
            return "UNKNOWN";
        }
        return normalized;
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
