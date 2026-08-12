package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.annotation.PostConstruct;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.governance.GovernanceIssue;
import com.cywu.dataos.controlplane.governance.GovernanceIssueDetail;
import com.cywu.dataos.controlplane.governance.GovernanceIssueEvent;
import com.cywu.dataos.controlplane.governance.GovernanceRepository;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
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
public class QualityWorkflowService {

    private final GovernanceRepository repository;
    private final List<QualityRuleExecutor> executors;
    private final NotificationService notifications;
    private final TransactionTemplate transactions;
    private final String executorName;
    private final long pollIntervalMs;
    private final long pollInitialDelayMs;
    private final long slaScanIntervalMs;
    private final long slaScanInitialDelayMs;
    private final long submitLeaseMs;
    private final java.util.Set<String> inFlight = ConcurrentHashMap.newKeySet();
    private final String workerId = "quality-worker-" + UUID.randomUUID();
    private final TenantScope tenantScope;

    public QualityWorkflowService(GovernanceRepository repository,
                                  List<QualityRuleExecutor> executors,
                                  NotificationService notifications,
                                  PlatformTransactionManager transactionManager,
                                  @Value("${data-os.quality.executor:HTTP}") String executorName,
                                  @Value("${data-os.quality.poll-interval-ms:30000}") long pollIntervalMs,
                                  @Value("${data-os.quality.poll-initial-delay-ms:10000}") long pollInitialDelayMs,
                                  @Value("${data-os.quality.sla-scan-interval-ms:60000}") long slaScanIntervalMs,
                                  @Value("${data-os.quality.sla-scan-initial-delay-ms:15000}") long slaScanInitialDelayMs,
                                  @Value("${data-os.quality.submit-lease-ms:120000}") long submitLeaseMs,
                                  TenantScope tenantScope) {
        this.repository = repository;
        this.executors = executors;
        this.notifications = notifications;
        this.transactions = new TransactionTemplate(transactionManager);
        this.executorName = executorName == null ? "HTTP" : executorName.trim().toUpperCase(Locale.ROOT);
        this.pollIntervalMs = pollIntervalMs;
        this.pollInitialDelayMs = pollInitialDelayMs;
        this.slaScanIntervalMs = slaScanIntervalMs;
        this.slaScanInitialDelayMs = slaScanInitialDelayMs;
        this.submitLeaseMs = submitLeaseMs;
        this.tenantScope = tenantScope;
    }

    @PostConstruct
    void validateSchedule() {
        validateDelay("data-os.quality.poll-interval-ms", pollIntervalMs, 1000, 3_600_000);
        validateDelay("data-os.quality.poll-initial-delay-ms", pollInitialDelayMs, 0, 3_600_000);
        validateDelay("data-os.quality.sla-scan-interval-ms", slaScanIntervalMs, 1000, 3_600_000);
        validateDelay("data-os.quality.sla-scan-initial-delay-ms", slaScanInitialDelayMs, 0, 3_600_000);
        validateDelay("data-os.quality.submit-lease-ms", submitLeaseMs, 5_000, 3_600_000);
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

    @Scheduled(
            fixedDelayString = "${data-os.quality.poll-interval-ms:30000}",
            initialDelayString = "${data-os.quality.poll-initial-delay-ms:10000}")
    public void scheduledSync() {
        for (var run : repository.findQualitySyncCandidates(Instant.now())) {
            syncOne(run);
        }
    }

    public GovernanceSlaScanResult scanSla(String tenantId, String institutionId) {
        var scope = tenantScope.resolve(tenantId, institutionId);
        return scanSlaScope(scope.tenantId(), scope.institutionId());
    }

    @Scheduled(
            fixedDelayString = "${data-os.quality.sla-scan-interval-ms:60000}",
            initialDelayString = "${data-os.quality.sla-scan-initial-delay-ms:15000}")
    public void scheduledSlaScan() {
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
                var updated = repository.markQualityRunError(run.id(), "暂不支持质量规则执行器：" + run.executor(),
                        null, "FAILED", run.status(), run.externalId(), statusWorkerId);
                if (updated == 1) applyTerminalResult(run.id(), run.issueId(), run.tenantId(), run.institutionId());
                return;
            }
            var result = executor.status(run.externalId());
            var status = normalizeStatus(result.status());
            var terminal = List.of("SUCCEEDED", "FAILED", "CANCELED").contains(status);
            var updated = repository.updateQualityRunStatus(run.id(), status, result.passed(), result.executionBatchId(),
                    result.message(), result.sampleEvidence(), result.artifactUri(), result.startedAt(), result.finishedAt(),
                    terminal ? null : Instant.now().plusMillis(pollIntervalMs), null,
                    run.status(), run.externalId(), statusWorkerId);
            if (updated == 1 && terminal) applyTerminalResult(run.id(), run.issueId(), run.tenantId(), run.institutionId());
        } catch (AdapterUnavailableException exception) {
            repository.markQualityRunError(run.id(), safeMessage(exception),
                    Instant.now().plusMillis(pollIntervalMs), null,
                    run.status(), run.externalId(), statusWorkerId);
        } catch (AdapterConfigurationException exception) {
            var updated = repository.markQualityRunError(run.id(), safeMessage(exception), null, "FAILED",
                    run.status(), run.externalId(), statusWorkerId);
            if (updated == 1) applyTerminalResult(run.id(), run.issueId(), run.tenantId(), run.institutionId());
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

    private void applyTerminalResult(String runId, String issueId, String tenantId, String institutionId) {
        transactions.execute(status -> {
            var issue = repository.findIssue(issueId, tenantId, institutionId).orElse(null);
            var run = repository.findQualityRun(runId, issueId, tenantId, institutionId).orElse(null);
            if (issue == null || run == null || !"RECHECKING".equals(issue.status())) return null;
            var pass = "SUCCEEDED".equals(run.status()) && Boolean.TRUE.equals(run.passed());
            var returned = !pass;
            var targetStatus = returned ? "RETURNED" : "CLOSED";
            var action = returned ? ("SUCCEEDED".equals(run.status()) ? "AUTO_RETURNED" : "RECHECK_FAILED") : "AUTO_CLOSED";
            var note = run.resultMessage() == null ? (returned ? "复检未通过，已退回治理" : "复检通过，已自动关闭")
                    : run.resultMessage();
            var now = Instant.now();
            if (repository.updateIssueAfterQualityResult(issueId, tenantId, institutionId,
                    targetStatus, note, action, now) == 1) {
                var eventId = repository.insertEvent(issueId, action, note, "质量复检编排器", now);
                var event = new GovernanceIssueEvent(eventId, issueId, action, note, "质量复检编排器", now);
                notifications.enqueue(issue, event,
                        returned ? "质量复检未通过，问题已退回" : "质量复检通过，问题已自动关闭",
                        "问题「" + issue.title() + "」的执行批次 " + run.executionBatchId() + " 已完成：" + note);
            }
            return null;
        });
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

    private void validateDelay(String name, long value, long min, long max) {
        if (value < min || value > max) {
            throw new IllegalStateException(name + " 必须在 " + min + " 到 " + max + " 毫秒之间");
        }
    }

    private String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) return "未知错误";
        return message.length() > 240 ? message.substring(0, 240) : message;
    }

    private record RecheckClaim(GovernanceIssue issue, String tenantId, String institutionId,
                                QualityRuleRun run, QualityRuleExecutionRequest request) {
    }
}
