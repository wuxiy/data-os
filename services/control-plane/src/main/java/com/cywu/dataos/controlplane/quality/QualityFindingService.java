package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.governance.GovernanceIssue;
import com.cywu.dataos.controlplane.governance.GovernanceIssueEvent;
import com.cywu.dataos.controlplane.governance.GovernanceRepository;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Turns a terminal result from an approved quality workflow into a durable
 * governance issue. This is the production source of issues; demo seed data
 * is not required. The finding key is supplied by the upstream workflow and
 * makes repeated batches idempotent per tenant and institution.
 */
@Service
public class QualityFindingService {

    private static final String EXECUTOR = "QUALITY_FINDING";

    private final GovernanceRepository repository;
    private final NotificationService notifications;
    private final TenantScope tenantScope;
    private final TransactionTemplate transactions;

    public QualityFindingService(GovernanceRepository repository,
                                 NotificationService notifications,
                                 TenantScope tenantScope,
                                 PlatformTransactionManager transactionManager) {
        this.repository = repository;
        this.notifications = notifications;
        this.tenantScope = tenantScope;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    public QualityFindingResult ingest(QualityFindingRequest request) {
        var safeRequest = request.withSampleEvidence(sanitizeEvidence(request.sampleEvidence()));
        var scope = tenantScope.resolve(safeRequest.tenantId(), safeRequest.institutionId());
        var tenant = scope.tenantId();
        var institution = scope.institutionId();
        var findingKey = normalizeKey(safeRequest.findingKey());
        var sourceSystem = normalizeKey(safeRequest.sourceSystem());
        var executionBatchId = normalizeKey(safeRequest.executionBatchId());
        var severity = normalizeSeverity(safeRequest.severity());
        var externalId = externalId(tenant, institution, sourceSystem, findingKey, executionBatchId);
        var issueSourceKey = issueSourceKey(sourceSystem, findingKey);
        var result = transactions.execute(status -> ingestInTransaction(safeRequest, tenant, institution,
                issueSourceKey, sourceSystem, severity, externalId));
        if (result == null) throw new IllegalStateException("质量问题结果未写入");
        return result;
    }

    private QualityFindingResult ingestInTransaction(QualityFindingRequest request,
                                                     String tenant,
                                                     String institution,
                                                     String issueSourceKey,
                                                     String sourceSystem,
                                                     String severity,
                                                     String externalId) {
        var existingRun = repository.findQualityRunByExternal(EXECUTOR, externalId);
        if (existingRun.isPresent()) {
            var existingIssue = repository.findIssue(existingRun.get().issueId(), tenant, institution).orElse(null);
            return new QualityFindingResult(existingIssue == null ? null : existingIssue.id(),
                    existingIssue == null ? "IGNORED" : existingIssue.status(),
                    false, Boolean.TRUE.equals(existingRun.get().passed()),
                    existingRun.get().executionBatchId(), "相同执行批次已登记");
        }

        var issue = repository.findIssueBySourceKey(issueSourceKey, tenant, institution).orElse(null);
        var now = Instant.now();
        var passed = Boolean.TRUE.equals(request.passed());
        var created = false;
        var action = passed ? "QUALITY_FINDING_PASSED" : "QUALITY_FINDING_DETECTED";
        var note = message(request, passed);

        if (issue == null && passed) {
            // A passing scheduled check has no governance object to create,
            // but its batch and evidence remain auditable as an observation.
            var runWrite = recordRun(null, tenant, institution, request, externalId, "SUCCEEDED", now);
            var run = runWrite.run();
            return new QualityFindingResult(null, "NO_ISSUE", false, true,
                    run.executionBatchId(), runWrite.inserted() ? "质量规则通过，未产生治理问题" : "相同执行批次已登记");
        }

        if (issue == null) {
            issue = insertIssue(request, tenant, institution, issueSourceKey, sourceSystem, severity, now);
            created = true;
        } else {
            var targetStatus = passed ? "CLOSED" : ("CLOSED".equals(issue.status()) ? "RETURNED" : issue.status());
            if (!targetStatus.equals(issue.status()) || !passed) {
                repository.updateIssueFromQualityFinding(issue.id(), tenant, institution, targetStatus, note,
                        action, now);
            }
            issue = repository.findIssue(issue.id(), tenant, institution).orElseThrow();
        }

        var runWrite = recordRun(issue.id(), tenant, institution, request, externalId,
                passed ? "SUCCEEDED" : "FAILED", now);
        var run = runWrite.run();
        if (!runWrite.inserted()) {
            return new QualityFindingResult(issue.id(), issue.status(), false, passed,
                    run.executionBatchId(), "相同执行批次已登记");
        }
        var eventId = repository.insertEvent(issue.id(), action, note, "质量规则执行器", now);
        var event = new GovernanceIssueEvent(eventId, issue.id(), action, note, "质量规则执行器", now);
        notifications.enqueue(issue, event,
                passed ? "质量检查通过" : "发现新的数据质量问题",
                passed ? "问题「" + issue.title() + "」已通过质量检查，执行批次：" + run.executionBatchId()
                        : "问题「" + issue.title() + "」检测失败，执行批次：" + run.executionBatchId());
        return new QualityFindingResult(issue.id(), issue.status(), created, passed,
                run.executionBatchId(), note);
    }

    private GovernanceIssue insertIssue(QualityFindingRequest request,
                                        String tenant,
                                        String institution,
                                        String issueSourceKey,
                                        String sourceSystem,
                                        String severity,
                                        Instant now) {
        var id = "DQ-" + UUID.randomUUID();
        try {
            repository.insertQualityFindingIssue(id, tenant, institution, request, issueSourceKey, sourceSystem,
                    severity, now);
        } catch (DuplicateKeyException duplicate) {
            // The repository insert runs in REQUIRES_NEW, so a concurrent
            // unique-key loser can safely read the winner in this transaction.
        }
        return repository.findIssueBySourceKey(issueSourceKey, tenant, institution)
                .orElseThrow(() -> new IllegalStateException("质量问题写入后无法读取"));
    }

    private GovernanceRepository.QualityFindingRunWrite recordRun(String issueId, String tenant, String institution,
                                                                   QualityFindingRequest request, String externalId,
                                                                   String status, Instant now) {
        try {
            return repository.recordQualityFindingRun(issueId, tenant, institution, request, EXECUTOR,
                    externalId, status, now);
        } catch (DuplicateKeyException duplicate) {
            var existing = repository.findQualityRunByExternal(EXECUTOR, externalId)
                    .orElseThrow(() -> duplicate);
            return new GovernanceRepository.QualityFindingRunWrite(existing, false);
        }
    }

    private String normalizeKey(String value) {
        var normalized = value == null ? "" : value.trim();
        if (normalized.isBlank() || normalized.length() > 300 || normalized.contains("\n")
                || normalized.contains("\r")) {
            throw new InvalidRequestException("质量问题来源键格式无效");
        }
        return normalized;
    }

    private String normalizeSeverity(String value) {
        var normalized = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
        if (!List.of("CRITICAL", "HIGH", "MEDIUM", "LOW").contains(normalized)) {
            throw new InvalidRequestException("质量问题严重度必须为 CRITICAL/HIGH/MEDIUM/LOW");
        }
        return normalized;
    }

    private String issueSourceKey(String sourceSystem, String findingKey) {
        var readable = sourceSystem + "|" + findingKey;
        return readable.length() <= 300 ? readable : "source|" + sha256Hex(readable);
    }

    private String externalId(String tenant, String institution, String sourceSystem,
                              String findingKey, String batchId) {
        // The database uniqueness constraint is global to the executor. Include
        // tenant and institution in the digest so identical hospital rule keys
        // cannot collide across scopes or make another tenant appear idempotent.
        var canonical = tenant + "|" + institution + "|" + sourceSystem + "|" + findingKey + "|" + batchId;
        return "finding|" + sourceSystem + "|" + sha256Hex(canonical);
    }

    private String sha256Hex(String canonical) {
        try {
            var digest = MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
            var hex = new StringBuilder(64);
            for (var value : digest) hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("运行时缺少 SHA-256", exception);
        }
    }

    private String message(QualityFindingRequest request, boolean passed) {
        var value = request.message() == null || request.message().isBlank()
                ? (passed ? "质量规则通过" : "质量规则未通过") : request.message().trim();
        return value.length() <= 1000 ? value : value.substring(0, 1000);
    }

    private List<java.util.Map<String, Object>> sanitizeEvidence(List<java.util.Map<String, Object>> evidence) {
        var safeRows = new java.util.ArrayList<java.util.Map<String, Object>>();
        for (var row : evidence == null ? List.<java.util.Map<String, Object>>of() : evidence) {
            var safe = new java.util.LinkedHashMap<String, Object>();
            if (row == null) continue;
            row.forEach((key, value) -> {
                var name = key == null ? "" : key.trim();
                if (!name.matches("[A-Za-z_][A-Za-z0-9_]{0,127}")) return;
                var text = value == null ? null : String.valueOf(value);
                var sensitive = name.matches("(?i).*(name|patient|person|phone|mobile|id_card|identity|address|encounter|visit|password|secret|token|sql|credential|connection).*" );
                var identifier = name.matches("(?i).*(^|_)(id|key|code)$") || name.endsWith("_id");
                if (text != null && (sensitive || identifier)
                        && !text.startsWith("hmac-sha256:") && !"[REDACTED]".equals(text)) {
                    text = "[REDACTED]";
                }
                if (text != null && text.length() > 256) text = text.substring(0, 256);
                safe.put(name, text);
            });
            safeRows.add(safe);
            if (safeRows.size() >= 20) break;
        }
        return List.copyOf(safeRows);
    }
}
