package com.cywu.dataos.controlplane.quality;

import java.sql.Timestamp;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.cywu.dataos.controlplane.run.RunStatus;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Propagation;

/**
 * 质量运行（外部运行的质量侧记录）的仓储：批次表 data_os.quality_rule_runs。
 * 提交/轮询租约列与 next_poll_at 退避的编码在此，供 QualityRunStore 适配。
 */
@Repository
public class QualityRunRepository {

    private static final String RUN_SELECT = """
            SELECT id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status, external_id,
                   execution_batch_id, passed, result_message, sample_evidence_json,
                   artifact_uri, reconciliation_status, reconciliation_message,
                   submitted_at, started_at, finished_at, attempt_count, next_poll_at,
                   last_error, updated_at
            FROM data_os.quality_rule_runs
            """;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public QualityRunRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
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
        return jdbc.query(RUN_SELECT + " WHERE id = ? AND issue_id = ? AND tenant_id = ? AND institution_id = ?",
                this::mapQualityRun, runId, issueId, tenantId, institutionId).stream().findFirst();
    }

    public Optional<QualityRuleRun> findQualityRunByExternal(String executor, String externalId) {
        return jdbc.query(RUN_SELECT + " WHERE executor = ? AND external_id = ?",
                this::mapQualityRun, executor, externalId).stream().findFirst();
    }

    @Transactional(propagation = Propagation.NESTED)
    public QualityFindingRunWrite recordQualityFindingRun(String issueId, String tenantId, String institutionId,
                                                          QualityFindingRequest request,
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
        var run = findQualityRunByExternal(executor, externalId);
        var persisted = run.orElseThrow(() -> new IllegalStateException("质量结果执行批次写入失败"));
        return new QualityFindingRunWrite(persisted, true);
    }

    public Optional<QualityRuleRun> findLatestQualityRun(String issueId, String tenantId, String institutionId) {
        return jdbc.query(RUN_SELECT + " WHERE issue_id = ? AND tenant_id = ? AND institution_id = ?"
                        + " ORDER BY submitted_at DESC LIMIT 1",
                this::mapQualityRun, issueId, tenantId, institutionId).stream().findFirst();
    }

    public List<QualityRuleRun> findQualityRuns(String issueId, String tenantId, String institutionId) {
        return jdbc.query(RUN_SELECT + " WHERE issue_id = ? AND tenant_id = ? AND institution_id = ?"
                        + " ORDER BY submitted_at DESC LIMIT 20",
                this::mapQualityRun, issueId, tenantId, institutionId);
    }

    public List<QualityRuleRun> findQualitySyncCandidates(Instant now) {
        return jdbc.query(RUN_SELECT + """
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

    private QualityRuleRun mapQualityRun(java.sql.ResultSet resultSet, int rowNumber) throws SQLException {
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
        return RunStatus.sanitized(value).name();
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

    public record QualityFindingRunWrite(QualityRuleRun run, boolean inserted) {
    }
}
