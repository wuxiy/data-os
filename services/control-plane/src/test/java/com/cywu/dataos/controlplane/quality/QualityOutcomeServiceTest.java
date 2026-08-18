package com.cywu.dataos.controlplane.quality;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.cywu.dataos.controlplane.governance.GovernanceIssue;
import com.cywu.dataos.controlplane.governance.GovernanceIssueEvent;
import com.cywu.dataos.controlplane.governance.IssueDetailReader;
import com.cywu.dataos.controlplane.governance.IssueRepository;
import com.cywu.dataos.controlplane.governance.NotificationOutboxRepository;
import com.cywu.dataos.controlplane.security.AuthProperties;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class QualityOutcomeServiceTest {

    @Test
    void rejectsSubmitLeaseOutsideOutcomePolicyBounds() {
        var service = new QualityOutcomeService(null, null, null, null, List.of(), null,
                transactionManager(new ArrayList<>()), "DEMO", 30_000, 4_999,
                new TenantScope(new AuthProperties()));

        assertThatThrownBy(service::validatePolicy)
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("data-os.quality.submit-lease-ms");
    }

    @Test
    void commitsTerminalRunAndGovernanceOutcomeInOneTransactionAfterAdapterCall() {
        var events = new ArrayList<String>();
        var issue = issue("RECHECKING");
        var running = run("RUNNING", null, null);
        var terminal = run("SUCCEEDED", true, "复检通过");
        var issues = new IssueRepository(null) {
            private GovernanceIssue currentIssue = issue;

            @Override
            public Optional<GovernanceIssue> findIssue(String id, String tenantId, String institutionId) {
                return Optional.of(currentIssue);
            }

            @Override
            public int updateIssueAfterQualityResult(String issueId, String tenantId, String institutionId,
                                                     String status, String note, String action, Instant actionAt) {
                events.add("issue");
                currentIssue = issue(status);
                return 1;
            }

            @Override
            public String insertEvent(String issueId, String eventType, String note, String actor, Instant createdAt) {
                events.add("event");
                return "event-1";
            }

            @Override
            public List<GovernanceIssueEvent> findEvents(String issueId) {
                return List.of();
            }
        };
        var runs = new QualityRunRepository(null, new ObjectMapper()) {
            private QualityRuleRun currentRun = running;

            @Override
            public Optional<QualityRuleRun> findQualityRun(String runId, String issueId,
                                                           String tenantId, String institutionId) {
                return Optional.of(currentRun);
            }

            @Override
            public int claimQualityRunForStatus(String runId, String workerId, Instant leaseUntil, Instant now,
                                                String expectedStatus, String expectedExternalId) {
                events.add("claim");
                return 1;
            }

            @Override
            public int updateQualityRunStatus(String runId, String status, Boolean passed,
                                              String executionBatchId, String message,
                                              List<Map<String, Object>> sampleEvidence, String artifactUri,
                                              Instant startedAt, Instant finishedAt, Instant nextPollAt,
                                              String lastError, String expectedStatus, String expectedExternalId,
                                              String statusWorkerId) {
                events.add("run");
                currentRun = terminal;
                return 1;
            }

            @Override
            public Optional<QualityRuleRun> findLatestQualityRun(String issueId, String tenantId,
                                                                 String institutionId) {
                return Optional.of(currentRun);
            }

            @Override
            public List<QualityRuleRun> findQualityRuns(String issueId, String tenantId, String institutionId) {
                return List.of(currentRun);
            }
        };
        var outbox = new NotificationOutboxRepository(null) {
            @Override
            public List<com.cywu.dataos.controlplane.governance.GovernanceNotification> findNotifications(String issueId) {
                return List.of();
            }
        };
        var notifications = new NotificationService(outbox, issues, List.of(), 5, 5_000) {
            @Override
            public com.cywu.dataos.controlplane.governance.GovernanceNotification enqueue(
                    GovernanceIssue issue, GovernanceIssueEvent event, String subject, String body) {
                events.add("notification");
                return null;
            }
        };
        var executor = new QualityRuleExecutor() {
            @Override
            public boolean supports(String name) {
                return "DEMO".equals(name);
            }

            @Override
            public QualityRuleSubmission submit(QualityRuleExecutionRequest request) {
                throw new UnsupportedOperationException();
            }

            @Override
            public QualityRuleExecutionStatus status(String externalId) {
                events.add("adapter");
                return new QualityRuleExecutionStatus("SUCCEEDED", true, "复检通过", "batch-1",
                        List.of(), null, Instant.now(), Instant.now());
            }
        };
        var service = new QualityOutcomeService(issues, runs, outbox,
                new IssueDetailReader(issues, runs, outbox), List.of(executor), notifications,
                transactionManager(events), "DEMO", 30_000, 120_000,
                new TenantScope(new AuthProperties()));

        service.sync("issue-1", "run-1", "default", "demo-hospital");

        assertThat(events).containsExactly(
                "claim", "adapter", "begin", "run", "issue", "event", "notification", "commit");
    }

    private static GovernanceIssue issue(String status) {
        return new GovernanceIssue("issue-1", "default", "demo-hospital", "完整性问题", "HIGH", status,
                "dataset-1", "rule-1", "信息中心", "owner-1", "负责人", "ticket-1", "一张表",
                Instant.now().plusSeconds(3600), "对象", null, Instant.now(), Instant.now(), null, null);
    }

    private static QualityRuleRun run(String status, Boolean passed, String message) {
        return new QualityRuleRun("run-1", "issue-1", "default", "demo-hospital", "rule-1", "dataset-1",
                "DEMO", status, "external-1", "batch-1", passed, message, List.of(), null, null, null,
                Instant.now(), Instant.now(), "SUCCEEDED".equals(status) ? Instant.now() : null,
                1, Instant.now(), null, Instant.now());
    }

    private static PlatformTransactionManager transactionManager(List<String> events) {
        return new PlatformTransactionManager() {
            @Override
            public TransactionStatus getTransaction(TransactionDefinition definition) {
                events.add("begin");
                return new SimpleTransactionStatus();
            }

            @Override
            public void commit(TransactionStatus status) {
                events.add("commit");
            }

            @Override
            public void rollback(TransactionStatus status) {
                events.add("rollback");
            }
        };
    }
}
