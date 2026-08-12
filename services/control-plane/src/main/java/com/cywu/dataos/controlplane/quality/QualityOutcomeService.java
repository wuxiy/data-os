package com.cywu.dataos.controlplane.quality;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.annotation.PostConstruct;
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.governance.GovernanceIssue;
import com.cywu.dataos.controlplane.governance.GovernanceIssueDetail;
import com.cywu.dataos.controlplane.governance.GovernanceIssueEvent;
import com.cywu.dataos.controlplane.governance.GovernanceRepository;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Orchestrates the quality-rule executor without holding a database
 * transaction over network calls. Each external result is reconciled with a
 * conditional update, so a duplicate poll cannot create duplicate workflow
 * events.
 */
@Service
public class QualityOutcomeService {

    private static final String FINDING_EXECUTOR = "QUALITY_FINDING";

    private final GovernanceRepository repository;
    private final List<QualityRuleExecutor> executors;
    private final NotificationService notifications;
    private final TransactionTemplate transactions;
    private final String executorName;
    private final long pollIntervalMs;
    private final long submitLeaseMs;
    private final java.util.Set<String> inFlight = ConcurrentHashMap.newKeySet();
    private final String workerId = "quality-worker-" + UUID.randomUUID();
    private final TenantScope tenantScope;

    public QualityOutcomeService(GovernanceRepository repository,
                                 List<QualityRuleExecutor> executors,
                                 NotificationService notifications,
                                 PlatformTransactionManager transactionManager,
                                 @Value("${data-os.quality.executor:HTTP}") String executorName,
                                 @Value("${data-os.quality.poll-interval-ms:30000}") long pollIntervalMs,
                                 @Value("${data-os.quality.submit-lease-ms:120000}") long submitLeaseMs,
                                 TenantScope tenantScope) {
        this.repository = repository;
        this.executors = executors;
        this.notifications = notifications;
        this.transactions = new TransactionTemplate(transactionManager);
        this.executorName = executorName == null ? "HTTP" : executorName.trim().toUpperCase(Locale.ROOT);
        this.pollIntervalMs = pollIntervalMs;
        this.submitLeaseMs = submitLeaseMs;
        this.tenantScope = tenantScope;
    }

    @PostConstruct
    void validatePolicy() {
        if (submitLeaseMs < 5_000 || submitLeaseMs > 3_600_000) {
            throw new IllegalStateException("data-os.quality.submit-lease-ms 必须在 5000 到 3600000 毫秒之间");
        }
    }

    /** Records a terminal result emitted by an approved external quality workflow. */
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

    public GovernanceIssueDetail requestRecheck(String issueId, String tenantId, String institutionId, String note) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var claim = transactions.execute(status -> claimRecheck(issueId, scope.tenantId(), scope.institutionId(), note));
        if (claim == null) throw new IllegalStateException("质量复检批次未创建");

        submitRun(claim);
        return detail(claim.issue().id(), claim.tenantId(), claim.institutionId());
    }

    public GovernanceIssueDetail sync(String issueId, String runId, String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var resolvedTenant = scope.tenantId();
        var resolvedInstitution = scope.institutionId();
        repository.findIssue(issueId, resolvedTenant, resolvedInstitution)
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
        var run = repository.findQualityRun(runId, issueId, resolvedTenant, resolvedInstitution)
                .orElseThrow(() -> new ResourceNotFoundException("未找到质量复检执行批次：" + runId));
        var now = Instant.now();
        if ("SUBMITTING".equals(run.status()) && run.nextPollAt() != null && run.nextPollAt().isAfter(now)) {
            return detail(issueId, resolvedTenant, resolvedInstitution);
        }
        syncOne(run);
        return detail(issueId, resolvedTenant, resolvedInstitution);
    }

    /** Re-open an UNKNOWN external batch for an explicit operator lookup. */
    public GovernanceIssueDetail reconcile(String issueId, String runId, String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var resolvedTenant = scope.tenantId();
        var resolvedInstitution = scope.institutionId();
        repository.findIssue(issueId, resolvedTenant, resolvedInstitution)
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
        var run = repository.findQualityRun(runId, issueId, resolvedTenant, resolvedInstitution)
                .orElseThrow(() -> new ResourceNotFoundException("未找到质量复检执行批次：" + runId));
        requireManualReconciliation(run);
        if (repository.reopenQualityRunForReconciliation(run.id()) != 1) {
            throw new ConflictException("质量执行批次状态已变化，请刷新后重试");
        }
        repository.findQualityRun(run.id(), issueId, resolvedTenant, resolvedInstitution)
                .ifPresent(this::syncOne);
        return detail(issueId, resolvedTenant, resolvedInstitution);
    }

    /** Confirm an UNKNOWN external batch is absent before returning the issue. */
    public GovernanceIssueDetail confirmAbsent(String issueId, String runId, String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        var resolvedTenant = scope.tenantId();
        var resolvedInstitution = scope.institutionId();
        var issue = repository.findIssue(issueId, resolvedTenant, resolvedInstitution)
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
        var run = repository.findQualityRun(runId, issueId, resolvedTenant, resolvedInstitution)
                .orElseThrow(() -> new ResourceNotFoundException("未找到质量复检执行批次：" + runId));
        requireManualReconciliation(run);
        var message = "人工确认外部质量执行批次不存在，问题已退回复核队列";
        // Keep the run terminal transition and the issue workflow transition in
        // one transaction; otherwise a database failure between the two can
        // leave a terminal run attached to an issue still marked RECHECKING.
        transactions.execute(status -> {
            if (repository.confirmQualityRunAbsent(run.id(), message) != 1) {
                throw new ConflictException("质量执行批次状态已变化，请刷新后重试");
            }
            var now = Instant.now();
            if (repository.updateIssueAfterQualityResult(issue.id(), resolvedTenant, resolvedInstitution,
                    "RETURNED", message, "RECHECK_CONFIRMED_ABSENT", now) != 1) {
                throw new ConflictException("治理问题状态已变化，请刷新后重试");
            }
            {
                var eventId = repository.insertEvent(issue.id(), "RECHECK_CONFIRMED_ABSENT",
                        message, "质量复检编排器", now);
                var event = new GovernanceIssueEvent(eventId, issue.id(), "RECHECK_CONFIRMED_ABSENT",
                        message, "质量复检编排器", now);
                notifications.enqueue(issue, event, "质量复检批次已人工确认不存在",
                        "问题「" + issue.title() + "」已退回处理队列，请确认后重新发起复检。");
            }
            return null;
        });
        return detail(issueId, resolvedTenant, resolvedInstitution);
    }

    public void syncPending() {
        for (var run : repository.findQualitySyncCandidates(Instant.now())) {
            syncOne(run);
        }
    }

    public GovernanceSlaScanResult scanSla(String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        return scanSlaScope(scope.tenantId(), scope.institutionId());
    }

    public void scanOverdue() {
        for (var scope : repository.findSlaScopes(Instant.now())) {
            scanSlaScope(scope.tenantId(), scope.institutionId());
        }
    }

    private RecheckClaim claimRecheck(String issueId, String tenantId, String institutionId, String note) {
        var tenant = tenantId;
        var institution = institutionId;
        var issue = repository.findIssue(issueId, tenant, institution)
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
        if ("CLOSED".equals(issue.status())) {
            throw new ConflictException("已关闭的治理问题不能直接复检");
        }
        if ("RECHECKING".equals(issue.status())) {
            throw new ConflictException("治理问题已在复检中，请等待结果");
        }
        var latest = repository.findLatestQualityRun(issueId, tenant, institution);
        if (latest.isPresent() && !latest.get().terminal()) {
            throw new ConflictException("治理问题已有质量复检批次在执行中，请等待结果");
        }
        var now = Instant.now();
        var resolvedNote = note == null || note.isBlank() ? "已按原质量规则发起复检" : note.trim();
        var batchId = "qr-" + UUID.randomUUID();
        if (repository.updateWorkflow(issueId, tenant, institution, "RECHECKING", resolvedNote, now,
                "RECHECK_REQUESTED") != 1) {
            throw new ConflictException("治理问题状态已变更，请刷新后重试复检");
        }
        var run = repository.createQualityRun(issueId, tenant, institution, issue.ruleId(), issue.datasetId(),
                executorName, batchId, now);
        var eventId = repository.insertEvent(issueId, "RECHECK_REQUESTED", resolvedNote, "当前治理负责人", now);
        var event = new GovernanceIssueEvent(eventId, issueId, "RECHECK_REQUESTED", resolvedNote, "当前治理负责人", now);
        notifications.enqueue(issue, event, "治理问题已进入质量复检",
                "问题「" + issue.title() + "」已提交质量规则执行器，执行批次：" + batchId);
        return new RecheckClaim(issue, tenant, institution, run,
                new QualityRuleExecutionRequest(issue.id(), tenant, institution, issue.title(), issue.ruleId(),
                        issue.datasetId(), batchId));
    }

    private void syncOne(QualityRuleRun run) {
        if (run.terminal() || ("SUBMITTING".equals(run.status()) && run.nextPollAt() != null
                && run.nextPollAt().isAfter(Instant.now()))
                || (!"SUBMITTING".equals(run.status())
                && (run.externalId() == null || run.externalId().isBlank()))
                || !inFlight.add(run.id())) return;
        var statusWorkerId = workerId + ":status";
        try {
            if ("SUBMITTING".equals(run.status())) {
                var issue = repository.findIssue(run.issueId(), run.tenantId(), run.institutionId()).orElse(null);
                if (issue == null) {
                    repository.markOrphanQualityRunSubmissionError(run.id(),
                            "治理问题已不存在，无法恢复质量复检投递", Instant.now());
                } else {
                    submitRun(new RecheckClaim(issue, run.tenantId(), run.institutionId(), run,
                            new QualityRuleExecutionRequest(issue.id(), run.tenantId(), run.institutionId(),
                                    issue.title(), run.ruleId(), run.datasetId(), run.executionBatchId())));
                }
                return;
            }
            var executor = findExecutor(run.executor());
            var claimed = repository.claimQualityRunForStatus(run.id(), statusWorkerId,
                    Instant.now().plusMillis(Math.max(5_000L, submitLeaseMs)), Instant.now(),
                    run.status(), run.externalId());
            if (claimed != 1) return;
            if (executor == null) {
                completeTerminalError(run, statusWorkerId, "暂不支持质量规则执行器：" + run.executor());
                return;
            }
            var result = executor.status(run.externalId());
            var status = normalizeStatus(result.status());
            var terminal = List.of("SUCCEEDED", "FAILED", "CANCELED").contains(status);
            if (terminal) {
                completeTerminalStatus(run, statusWorkerId, status, result);
            } else {
                repository.updateQualityRunStatus(run.id(), status, result.passed(), result.executionBatchId(),
                        result.message(), result.sampleEvidence(), result.artifactUri(), result.startedAt(),
                        result.finishedAt(), Instant.now().plusMillis(pollIntervalMs), null,
                        run.status(), run.externalId(), statusWorkerId);
            }
        } catch (AdapterUnavailableException exception) {
            repository.markQualityRunError(run.id(), safeMessage(exception),
                    Instant.now().plusMillis(pollIntervalMs), null,
                    run.status(), run.externalId(), statusWorkerId);
        } catch (AdapterConfigurationException exception) {
            completeTerminalError(run, statusWorkerId, safeMessage(exception));
        } catch (RuntimeException exception) {
            repository.markQualityRunError(run.id(), "状态同步失败：" + safeMessage(exception),
                    Instant.now().plusMillis(pollIntervalMs), null,
                    run.status(), run.externalId(), workerId + ":status");
        } finally {
            inFlight.remove(run.id());
        }
    }

    private void requireManualReconciliation(QualityRuleRun run) {
        if (!"UNKNOWN".equals(run.status()) || run.externalId() == null || run.externalId().isBlank()
                || !"MANUAL_REQUIRED".equals(run.reconciliationStatus())) {
            throw new ConflictException("当前质量执行批次不处于待人工对账状态");
        }
    }

    private void submitRun(RecheckClaim claim) {
        var executor = findExecutor(claim.run().executor());
        var now = Instant.now();
        if (repository.claimQualityRunForSubmission(claim.run().id(), workerId,
                now.plusMillis(submitLeaseMs), now) != 1) return;
        try {
            if (executor == null) {
                completeSubmissionFailure(claim, "暂不支持质量规则执行器：" + claim.run().executor(), workerId);
                return;
            }
            var submission = executor.submit(claim.request());
            if (submission == null || submission.externalId() == null || submission.externalId().isBlank()) {
                completeSubmissionFailure(claim, "质量规则执行器未返回外部批次编号", workerId);
            } else {
                repository.markQualityRunSubmitted(claim.run().id(), workerId, submission.externalId(), submission.message(),
                        Instant.now().plusMillis(pollIntervalMs));
            }
        } catch (AdapterUnavailableException exception) {
            repository.markQualityRunSubmissionError(claim.run().id(), workerId, safeMessage(exception),
                    retryAt(claim.run()));
        } catch (AdapterConfigurationException exception) {
            completeSubmissionFailure(claim, safeMessage(exception), workerId);
        } catch (RuntimeException exception) {
            completeSubmissionFailure(claim, safeMessage(exception), workerId);
        }
    }

    private Instant retryAt(QualityRuleRun run) {
        var multiplier = 1L << Math.min(6, Math.max(0, run.attemptCount()));
        var delay = Math.min(3_600_000L, Math.max(1_000L, pollIntervalMs) * multiplier);
        return Instant.now().plusMillis(delay);
    }

    private void completeSubmissionFailure(RecheckClaim claim, String message, String workerId) {
        transactions.execute(status -> {
            if (repository.markQualityRunSubmissionError(claim.run().id(), workerId, message, null, "SUBMIT_FAILED") != 1) {
                return null;
            }
            var now = Instant.now();
            if (repository.updateIssueAfterQualityResult(claim.issue().id(), claim.tenantId(), claim.institutionId(),
                    "RETURNED", "复检提交失败：" + message, "RECHECK_SUBMIT_FAILED", now) == 1) {
                var eventId = repository.insertEvent(claim.issue().id(), "RECHECK_SUBMIT_FAILED", message,
                        "质量复检编排器", now);
                var event = new GovernanceIssueEvent(eventId, claim.issue().id(), "RECHECK_SUBMIT_FAILED",
                        message, "质量复检编排器", now);
                notifications.enqueue(claim.issue(), event, "质量复检提交失败",
                        "问题「" + claim.issue().title() + "」未能投递到质量规则执行器：" + message);
            }
            return null;
        });
    }

    private void completeTerminalStatus(QualityRuleRun run, String statusWorkerId, String status,
                                        QualityRuleExecutionStatus result) {
        transactions.executeWithoutResult(transaction -> {
            var updated = repository.updateQualityRunStatus(run.id(), status, result.passed(),
                    result.executionBatchId(), result.message(), result.sampleEvidence(), result.artifactUri(),
                    result.startedAt(), result.finishedAt(), null, null,
                    run.status(), run.externalId(), statusWorkerId);
            if (updated == 1) applyTerminalResultInTransaction(run);
        });
    }

    private void completeTerminalError(QualityRuleRun run, String statusWorkerId, String message) {
        transactions.executeWithoutResult(transaction -> {
            var updated = repository.markQualityRunError(run.id(), message, null, "FAILED",
                    run.status(), run.externalId(), statusWorkerId);
            if (updated == 1) applyTerminalResultInTransaction(run);
        });
    }

    private void applyTerminalResultInTransaction(QualityRuleRun claimedRun) {
            var issue = repository.findIssue(claimedRun.issueId(), claimedRun.tenantId(),
                    claimedRun.institutionId()).orElse(null);
            var run = repository.findQualityRun(claimedRun.id(), claimedRun.issueId(), claimedRun.tenantId(),
                    claimedRun.institutionId()).orElse(null);
            if (issue == null || run == null || !"RECHECKING".equals(issue.status())) return;
            var pass = "SUCCEEDED".equals(run.status()) && Boolean.TRUE.equals(run.passed());
            var returned = !pass;
            var targetStatus = returned ? "RETURNED" : "CLOSED";
            var action = returned ? ("SUCCEEDED".equals(run.status()) ? "AUTO_RETURNED" : "RECHECK_FAILED") : "AUTO_CLOSED";
            var note = run.resultMessage() == null ? (returned ? "复检未通过，已退回治理" : "复检通过，已自动关闭")
                    : run.resultMessage();
            var now = Instant.now();
            if (repository.updateIssueAfterQualityResult(issue.id(), issue.tenantId(), issue.institutionId(),
                    targetStatus, note, action, now) == 1) {
                var eventId = repository.insertEvent(issue.id(), action, note, "质量复检编排器", now);
                var event = new GovernanceIssueEvent(eventId, issue.id(), action, note, "质量复检编排器", now);
                notifications.enqueue(issue, event,
                        returned ? "质量复检未通过，问题已退回" : "质量复检通过，问题已自动关闭",
                        "问题「" + issue.title() + "」的执行批次 " + run.executionBatchId() + " 已完成：" + note);
            }
    }

    private GovernanceSlaScanResult scanSlaScope(String tenant, String institution) {
        var processed = 0;
        var notified = 0;
        for (var issue : repository.findSlaCandidates(tenant, institution, Instant.now())) {
            var result = transactions.execute(status -> {
                var now = Instant.now();
                if (repository.markSlaOverdue(issue.id(), tenant, institution, now) != 1) return false;
                var note = "SLA 已逾期，截止时间：" + issue.dueAt();
                var eventId = repository.insertEvent(issue.id(), "SLA_OVERDUE", note, "治理自动化", now);
                var event = new GovernanceIssueEvent(eventId, issue.id(), "SLA_OVERDUE", note, "治理自动化", now);
                notifications.enqueue(issue, event, "治理问题 SLA 已逾期",
                        "问题「" + issue.title() + "」已超过 SLA，请责任人处理。");
                return true;
            });
            if (Boolean.TRUE.equals(result)) {
                processed++;
                notified++;
            }
        }
        return new GovernanceSlaScanResult(processed, notified);
    }

    private GovernanceIssueDetail detail(String issueId, String tenantId, String institutionId) {
        var issue = repository.findIssue(issueId, tenantId, institutionId)
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
        return new GovernanceIssueDetail(issue, repository.findEvents(issueId),
                repository.findLatestQualityRun(issueId, tenantId, institutionId).orElse(null),
                repository.findQualityRuns(issueId, tenantId, institutionId), repository.findNotifications(issueId));
    }

    private QualityRuleExecutor findExecutor(String value) {
        return executors.stream().filter(item -> item.supports(value)).findFirst().orElse(null);
    }

    private String normalizeStatus(String status) {
        if (status == null) return "UNKNOWN";
        return switch (status.trim().toUpperCase(Locale.ROOT)) {
            case "SUBMITTED", "PENDING", "QUEUED" -> "SUBMITTED";
            case "RUNNING", "STARTED" -> "RUNNING";
            case "SUCCEEDED", "SUCCESS", "PASSED", "FINISHED" -> "SUCCEEDED";
            case "FAILED", "ERROR" -> "FAILED";
            case "CANCELED", "CANCELLED", "STOPPED" -> "CANCELED";
            default -> "UNKNOWN";
        };
    }

    private String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) return "未知错误";
        return message.length() > 240 ? message.substring(0, 240) : message;
    }

    private record RecheckClaim(GovernanceIssue issue, String tenantId, String institutionId,
                                QualityRuleRun run, QualityRuleExecutionRequest request) {
    }

    private QualityFindingResult ingestInTransaction(QualityFindingRequest request,
                                                     String tenant,
                                                     String institution,
                                                     String issueSourceKey,
                                                     String sourceSystem,
                                                     String severity,
                                                     String externalId) {
        var existingRun = repository.findQualityRunByExternal(FINDING_EXECUTOR, externalId);
        if (existingRun.isPresent()) {
            var existingIssue = repository.findIssue(existingRun.get().issueId(), tenant, institution).orElse(null);
            return new QualityFindingResult(existingIssue == null ? null : existingIssue.id(),
                    existingIssue == null ? "IGNORED" : existingIssue.status(), false,
                    Boolean.TRUE.equals(existingRun.get().passed()), existingRun.get().executionBatchId(),
                    "相同执行批次已登记");
        }

        var issue = repository.findIssueBySourceKey(issueSourceKey, tenant, institution).orElse(null);
        var now = Instant.now();
        var passed = Boolean.TRUE.equals(request.passed());
        var created = false;
        var action = passed ? "QUALITY_FINDING_PASSED" : "QUALITY_FINDING_DETECTED";
        var note = findingMessage(request, passed);

        if (issue == null && passed) {
            var runWrite = recordFindingRun(null, tenant, institution, request, externalId, "SUCCEEDED", now);
            var run = runWrite.run();
            return new QualityFindingResult(null, "NO_ISSUE", false, true, run.executionBatchId(),
                    runWrite.inserted() ? "质量规则通过，未产生治理问题" : "相同执行批次已登记");
        }

        if (issue == null) {
            issue = insertFindingIssue(request, tenant, institution, issueSourceKey, sourceSystem, severity, now);
            created = true;
        } else {
            var targetStatus = passed ? "CLOSED" : ("CLOSED".equals(issue.status()) ? "RETURNED" : issue.status());
            if (!targetStatus.equals(issue.status()) || !passed) {
                repository.updateIssueFromQualityFinding(issue.id(), tenant, institution, targetStatus, note,
                        action, now);
            }
            issue = repository.findIssue(issue.id(), tenant, institution).orElseThrow();
        }

        var runWrite = recordFindingRun(issue.id(), tenant, institution, request, externalId,
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

    private GovernanceIssue insertFindingIssue(QualityFindingRequest request, String tenant, String institution,
                                               String issueSourceKey, String sourceSystem, String severity,
                                               Instant now) {
        var id = "DQ-" + UUID.randomUUID();
        try {
            repository.insertQualityFindingIssue(id, tenant, institution, request, issueSourceKey, sourceSystem,
                    severity, now);
        } catch (DuplicateKeyException duplicate) {
            // NESTED rolls back only the conflicting insert savepoint; the
            // caller's outcome transaction remains usable for the winner.
        }
        return repository.findIssueBySourceKey(issueSourceKey, tenant, institution)
                .orElseThrow(() -> new IllegalStateException("质量问题写入后无法读取"));
    }

    private GovernanceRepository.QualityFindingRunWrite recordFindingRun(
            String issueId, String tenant, String institution, QualityFindingRequest request,
            String externalId, String status, Instant now) {
        try {
            return repository.recordQualityFindingRun(issueId, tenant, institution, request, FINDING_EXECUTOR,
                    externalId, status, now);
        } catch (DuplicateKeyException duplicate) {
            var existing = repository.findQualityRunByExternal(FINDING_EXECUTOR, externalId)
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
        return "finding|" + sourceSystem + "|"
                + sha256Hex(tenant + "|" + institution + "|" + sourceSystem + "|" + findingKey + "|" + batchId);
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

    private String findingMessage(QualityFindingRequest request, boolean passed) {
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
                var sensitive = name.matches("(?i).*(name|patient|person|phone|mobile|id_card|identity|address|encounter|visit|password|secret|token|sql|credential|connection).*");
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
