package com.cywu.dataos.controlplane;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.sun.net.httpserver.HttpServer;
import org.springframework.jdbc.core.JdbcTemplate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.client.RestClient;
import com.cywu.dataos.controlplane.governance.GovernanceIssueEvent;
import com.cywu.dataos.controlplane.governance.GovernanceRepository;
import com.cywu.dataos.controlplane.quality.NotificationService;
import com.cywu.dataos.controlplane.quality.WebhookNotificationChannel;
import com.cywu.dataos.controlplane.quality.QualityWorkflowService;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class ControlPlaneApiTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private GovernanceRepository governanceRepository;

    @Autowired
    private QualityWorkflowService qualityWorkflow;

    @Autowired
    private NotificationService notificationService;

    @Test
    void registersAndListsSourceThroughPublicApi() throws Exception {
        mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantId":"default",
                                  "institutionId":"demo-hospital",
                                  "name":"LIS",
                                  "systemType":"LIS",
                                  "protocol":"JDBC"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("/api/v1/sources/")))
                .andExpect(jsonPath("$.status", is("PENDING")));

        mockMvc.perform(get("/api/v1/sources")
                        .param("tenantId", "default")
                        .param("institutionId", "demo-hospital"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(1)))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].protocol", is("JDBC")));
    }

    @Test
    void returnsGovernanceSummaryFromControlDatabase() throws Exception {
        mockMvc.perform(get("/api/v1/governance/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantId", is("default")))
                .andExpect(jsonPath("$.institutionId", is("demo-hospital")))
                .andExpect(jsonPath("$.metrics", hasSize(0)))
                .andExpect(jsonPath("$.issues", hasSize(0)));
    }

    @Test
    void managesGovernanceIssueWorkflowThroughPublicApi() throws Exception {
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.governance_issues
                    (id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id,
                     owner_department, owner_name, ticket_id, impact, due_at)
                VALUES ('DQ-TEST-001', 'default', 'demo-hospital', '测试质量问题', 'HIGH', 'OVERDUE',
                        'asset-test', 'rule-test', '信息中心', '测试负责人', 'TICKET-TEST-001',
                        '测试主题 / 1 张表', ?)
                """, now);

        mockMvc.perform(get("/api/v1/governance/issues")
                        .param("status", "OVERDUE")
                        .param("query", "测试"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(1)))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id", is("DQ-TEST-001")))
                .andExpect(jsonPath("$.items[0].status", is("OVERDUE")));

        mockMvc.perform(get("/api/v1/governance/issues/DQ-TEST-001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.title", is("测试质量问题")))
                .andExpect(jsonPath("$.events", hasSize(0)));

        mockMvc.perform(put("/api/v1/governance/issues/DQ-TEST-001/workflow")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"status":"IN_PROGRESS","note":"已补齐接口数据，准备复检。"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.status", is("IN_PROGRESS")))
                .andExpect(jsonPath("$.issue.processingNote", is("已补齐接口数据，准备复检。")))
                .andExpect(jsonPath("$.events", hasSize(1)))
                .andExpect(jsonPath("$.events[0].eventType", is("WORKFLOW_UPDATED")));

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-001/recheck")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"按原规则重新执行\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.status", is("RECHECKING")))
                .andExpect(jsonPath("$.events", hasSize(2)))
                .andExpect(jsonPath("$.runs", hasSize(1)))
                .andExpect(jsonPath("$.events[0].eventType", is("RECHECK_REQUESTED")));

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-001/notifications/remind")
                        .header("Idempotency-Key", "reminder-test-001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.status", is("RECHECKING")))
                .andExpect(jsonPath("$.events[0].eventType", is("RESPONSIBLE_REMINDER_REQUESTED")))
                .andExpect(jsonPath("$.notifications", hasSize(2)));

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-001/notifications/remind")
                        .header("Idempotency-Key", "reminder-test-001"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.events", hasSize(3)))
                .andExpect(jsonPath("$.notifications", hasSize(2)));
    }

    @Test
    void protectsGovernanceIssueWorkflowBoundaries() throws Exception {
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.governance_issues
                    (id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id,
                     owner_department, owner_name, ticket_id, impact, due_at)
                VALUES ('DQ-TEST-002', 'default', 'demo-hospital', '边界质量问题', 'MEDIUM', 'CLOSED',
                        'asset-test', 'rule-test', '信息中心', '测试负责人', 'TICKET-TEST-002',
                        '测试主题 / 1 张表', ?)
                """, now);

        mockMvc.perform(put("/api/v1/governance/issues/DQ-TEST-002/workflow")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"UNKNOWN\",\"note\":\"非法状态\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_REQUEST")));

        mockMvc.perform(put("/api/v1/governance/issues/DQ-TEST-002/workflow")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"IN_PROGRESS\",\"note\":\"" + "x".repeat(1001) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("VALIDATION_ERROR")))
                .andExpect(jsonPath("$.fields.note", is("note 不能超过 1000 个字符")));

        mockMvc.perform(put("/api/v1/governance/issues/DQ-TEST-002/workflow")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"RECHECKING\",\"note\":\"不得直接改写复检态\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_REQUEST")));

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-002/recheck"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", is("已关闭的治理问题不能直接复检")));

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-002/notifications/remind")
                        .header("Idempotency-Key", "closed-reminder-001"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", is("已关闭的治理问题不需要提醒责任人")));

        jdbc.update("UPDATE data_os.governance_issues SET status = 'RECHECKING' WHERE id = 'DQ-TEST-002'");
        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-002/recheck"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", is("治理问题已在复检中，请等待结果")));
    }

    @Test
    void submitsQualityRecheckAndAutomaticallyClosesWhenRulePasses() throws Exception {
        insertIssue("DQ-TEST-003", "可通过质量复检", "rule-pass", "PENDING_RECHECK", Instant.now().plusSeconds(3600));

        var recheckResponse = mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-003/recheck")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"note\":\"提交质量规则复检\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.status", is("RECHECKING")))
                .andExpect(jsonPath("$.runs", hasSize(1)))
                .andExpect(jsonPath("$.latestRun.status", is("SUBMITTED")))
                .andExpect(jsonPath("$.latestRun.executionBatchId").isString())
                .andReturn().getResponse().getContentAsString();
        var runId = recheckResponse.replaceAll(".*\\\"latestRun\\\":\\{\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-003/runs/" + runId + "/sync"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.status", is("CLOSED")))
                .andExpect(jsonPath("$.latestRun.status", is("SUCCEEDED")))
                .andExpect(jsonPath("$.latestRun.passed", is(true)))
                .andExpect(jsonPath("$.latestRun.sampleEvidence", hasSize(1)))
                .andExpect(jsonPath("$.events[0].eventType", is("AUTO_CLOSED")));
    }

    @Test
    void returnsIssueWhenQualityRecheckFailsWithSampleEvidence() throws Exception {
        insertIssue("DQ-TEST-004", "质量复检失败样例", "rule-fail", "PENDING_RECHECK", Instant.now().plusSeconds(3600));

        var recheckResponse = mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-004/recheck"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.latestRun.status", is("SUBMITTED")))
                .andExpect(jsonPath("$.runs", hasSize(1)))
                .andReturn().getResponse().getContentAsString();
        var runId = recheckResponse.replaceAll(".*\\\"latestRun\\\":\\{\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-004/runs/" + runId + "/sync"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.status", is("RETURNED")))
                .andExpect(jsonPath("$.latestRun.status", is("SUCCEEDED")))
                .andExpect(jsonPath("$.latestRun.passed", is(false)))
                .andExpect(jsonPath("$.latestRun.sampleEvidence", hasSize(1)))
                .andExpect(jsonPath("$.events[0].eventType", is("AUTO_RETURNED")));
    }

    @Test
    void scansSlaOnceAndDeliversOwnerNotificationIdempotently() throws Exception {
        insertIssue("DQ-TEST-005", "SLA 逾期通知样例", "rule-fail", "PENDING", Instant.now().minusSeconds(60));

        mockMvc.perform(post("/api/v1/governance/sla/scan"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.processed", is(1)))
                .andExpect(jsonPath("$.notified", is(1)));

        mockMvc.perform(post("/api/v1/governance/sla/scan"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.processed", is(0)))
                .andExpect(jsonPath("$.notified", is(0)));

        mockMvc.perform(get("/api/v1/governance/issues/DQ-TEST-005"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.status", is("OVERDUE")))
                .andExpect(jsonPath("$.issue.slaOverdueAt").isString())
                .andExpect(jsonPath("$.events[0].eventType", is("SLA_OVERDUE")))
                .andExpect(jsonPath("$.notifications", hasSize(1)))
                .andExpect(jsonPath("$.notifications[0].status", is("PENDING")));

        mockMvc.perform(post("/api/v1/governance/notifications/deliver"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.processed", is(1)))
                .andExpect(jsonPath("$.skipped", is(1)))
                .andExpect(jsonPath("$.sent", is(0)));

        mockMvc.perform(post("/api/v1/governance/notifications/deliver"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.processed", is(0)));

        mockMvc.perform(get("/api/v1/governance/issues/DQ-TEST-005"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notifications[0].status", is("SKIPPED")));
    }

    @Test
    void refusesWorkflowEditsWhileQualityRecheckIsRunning() throws Exception {
        insertIssue("DQ-TEST-006", "复检中不可改写", "rule-pass", "PENDING_RECHECK", Instant.now().plusSeconds(3600));

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-006/recheck"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.issue.status", is("RECHECKING")));

        mockMvc.perform(put("/api/v1/governance/issues/DQ-TEST-006/workflow")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"IN_PROGRESS\",\"note\":\"不应覆盖复检状态\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", is("治理问题正在复检中，不能改写工作流状态")));
    }

    @Test
    void resumesSubmittingQualityRunAfterControlPlaneRestartWindow() {
        insertIssue("DQ-TEST-007", "恢复提交中的复检", "rule-pass", "RECHECKING", Instant.now().plusSeconds(3600));
        var now = Timestamp.from(Instant.now().minusSeconds(1));
        jdbc.update("""
                INSERT INTO data_os.quality_rule_runs
                    (id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status,
                     execution_batch_id, submitted_at, next_poll_at, updated_at)
                VALUES ('run-recovery-007', 'DQ-TEST-007', 'default', 'demo-hospital', 'rule-pass',
                        'asset-test', 'DEMO', 'SUBMITTING', 'qr-recovery-007', ?, ?, ?)
                """, now, now, now);

        qualityWorkflow.scheduledSync();

        var run = jdbc.queryForMap("SELECT status, external_id FROM data_os.quality_rule_runs WHERE id = 'run-recovery-007'");
        org.assertj.core.api.Assertions.assertThat(run.get("STATUS")).isEqualTo("SUBMITTED");
        org.assertj.core.api.Assertions.assertThat(run.get("EXTERNAL_ID")).isNotNull();
    }

    @Test
    void manualSyncDoesNotResubmitSubmittingRunBeforeBackoff() throws Exception {
        insertIssue("DQ-TEST-007B", "退避窗口内不重复投递", "rule-pass", "RECHECKING", Instant.now().plusSeconds(3600));
        var future = Timestamp.from(Instant.now().plusSeconds(3600));
        jdbc.update("""
                INSERT INTO data_os.quality_rule_runs
                    (id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status,
                     execution_batch_id, submitted_at, next_poll_at, updated_at)
                VALUES ('run-backoff-007b', 'DQ-TEST-007B', 'default', 'demo-hospital', 'rule-pass',
                        'asset-test', 'DEMO', 'SUBMITTING', 'qr-backoff-007b', ?, ?, ?)
                """, future, future, future);

        mockMvc.perform(post("/api/v1/governance/issues/DQ-TEST-007B/runs/run-backoff-007b/sync"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.latestRun.status", is("SUBMITTING")))
                .andExpect(jsonPath("$.latestRun.externalId", org.hamcrest.Matchers.nullValue()));
    }

    @Test
    void submissionResultMustBeWrittenByCurrentLeaseOwner() {
        insertIssue("DQ-TEST-007C", "提交租约所有权", "rule-pass", "RECHECKING", Instant.now().plusSeconds(3600));
        var now = Instant.now();
        var run = governanceRepository.createQualityRun("DQ-TEST-007C", "default", "demo-hospital",
                "rule-pass", "asset-test", "DEMO", "qr-lease-007c", now);
        org.assertj.core.api.Assertions.assertThat(governanceRepository.claimQualityRunForSubmission(
                run.id(), "worker-a", now.plusSeconds(120), now)).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(governanceRepository.markQualityRunSubmitted(
                run.id(), "worker-b", "external-b", "错误 worker", now)).isEqualTo(0);
        org.assertj.core.api.Assertions.assertThat(governanceRepository.markQualityRunSubmitted(
                run.id(), "worker-a", "external-a", "当前 worker", now)).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                "SELECT external_id FROM data_os.quality_rule_runs WHERE id = ?", String.class, run.id()))
                .isEqualTo("external-a");
    }

    @Test
    void claimsNotificationOnceWhenManualAndScheduledDeliveryOverlap() throws Exception {
        insertIssue("DQ-TEST-008", "通知抢占边界", "rule-pass", "PENDING", Instant.now().plusSeconds(3600));
        var issue = governanceRepository.findIssue("DQ-TEST-008", "default", "demo-hospital").orElseThrow();
        var now = Instant.now();
        var eventId = governanceRepository.insertEvent(issue.id(), "TEST_NOTIFICATION", "并发测试", "测试", now);
        notificationService.enqueue(issue,
                new GovernanceIssueEvent(eventId, issue.id(), "TEST_NOTIFICATION", "并发测试", "测试", now),
                "并发通知", "验证数据库租约抢占");

        var executor = Executors.newFixedThreadPool(2);
        try {
            var ready = new CountDownLatch(2);
            var start = new CountDownLatch(1);
            var first = executor.submit(() -> deliverAfter(start, ready));
            var second = executor.submit(() -> deliverAfter(start, ready));
            ready.await(2, TimeUnit.SECONDS);
            start.countDown();
            var processed = first.get(5, TimeUnit.SECONDS).processed() + second.get(5, TimeUnit.SECONDS).processed();
            org.assertj.core.api.Assertions.assertThat(processed).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void concurrentReminderWithSameIdempotencyKeyCreatesOneEventAndNotification() throws Exception {
        insertIssue("DQ-TEST-008B", "并发提醒幂等", "rule-pass", "PENDING", Instant.now().plusSeconds(3600));
        var executor = Executors.newFixedThreadPool(2);
        try {
            var ready = new CountDownLatch(2);
            var start = new CountDownLatch(1);
            var first = executor.submit(() -> remindAfter(start, ready));
            var second = executor.submit(() -> remindAfter(start, ready));
            ready.await(2, TimeUnit.SECONDS);
            start.countDown();
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
            org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                    "SELECT COUNT(*) FROM data_os.governance_issue_events WHERE issue_id = ?", Integer.class,
                    "DQ-TEST-008B")).isEqualTo(1);
            org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                    "SELECT COUNT(*) FROM data_os.governance_notifications WHERE issue_id = ?", Integer.class,
                    "DQ-TEST-008B")).isEqualTo(1);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void retriesWebhookAfterTransientFailure() throws Exception {
        var attempts = new java.util.concurrent.atomic.AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/notify", exchange -> {
            var attempt = attempts.incrementAndGet();
            var status = attempt == 1 ? 500 : 204;
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();
        try {
            insertIssue("DQ-TEST-009", "Webhook 重试样例", "rule-pass", "PENDING", Instant.now().plusSeconds(3600));
            var issue = governanceRepository.findIssue("DQ-TEST-009", "default", "demo-hospital").orElseThrow();
            var now = Instant.now();
            var eventId = governanceRepository.insertEvent(issue.id(), "TEST_WEBHOOK", "重试测试", "测试", now);
            var channel = new WebhookNotificationChannel(RestClient.builder(),
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/notify");
            var service = new NotificationService(governanceRepository, List.of(channel), 3, 60_000);
            var notification = service.enqueue(issue,
                    new GovernanceIssueEvent(eventId, issue.id(), "TEST_WEBHOOK", "重试测试", "测试", now),
                    "Webhook 重试", "验证失败后退避");

            org.assertj.core.api.Assertions.assertThat(service.deliverPending().failed()).isEqualTo(1);
            jdbc.update("UPDATE data_os.governance_notifications SET next_attempt_at = ? WHERE id = ?",
                    Timestamp.from(Instant.now()), notification.id());
            org.assertj.core.api.Assertions.assertThat(service.deliverPending().sent()).isEqualTo(1);
            org.assertj.core.api.Assertions.assertThat(jdbc.queryForObject(
                    "SELECT status FROM data_os.governance_notifications WHERE id = ?", String.class, notification.id()))
                    .isEqualTo("SENT");
            org.assertj.core.api.Assertions.assertThat(attempts.get()).isEqualTo(2);
        } finally {
            server.stop(0);
        }
    }

    private NotificationService.DeliverySummary deliverAfter(CountDownLatch start, CountDownLatch ready) {
        ready.countDown();
        try {
            start.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
        return notificationService.deliverPending();
    }

    private Object remindAfter(CountDownLatch start, CountDownLatch ready) {
        ready.countDown();
        try {
            start.await(2, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
        return notificationService.remind("DQ-TEST-008B", "default", "demo-hospital", "same-reminder-key");
    }

    private void insertIssue(String id, String title, String ruleId, String status, Instant dueAt) {
        jdbc.update("""
                INSERT INTO data_os.governance_issues
                    (id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id,
                     owner_department, owner_name, ticket_id, impact, due_at)
                VALUES (?, 'default', 'demo-hospital', ?, 'MEDIUM', ?, 'asset-test', ?,
                        '信息中心', '测试负责人', ?, '测试主题 / 1 张表', ?)
                """, id, title, status, ruleId, "TICKET-" + id, Timestamp.from(dueAt));
    }

    @Test
    void validatesSourceRequiredFields() throws Exception {
        mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("VALIDATION_ERROR")))
                .andExpect(jsonPath("$.fields.name", is("name 不能为空")));
    }

    @Test
    void recordsBlockedRunWhenExecutorIsNotConfigured() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"运行测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"运行测试作业\"}"))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        var runResponse = mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")))
                .andExpect(jsonPath("$.executor", is("SEATUNNEL")))
                .andReturn().getResponse().getContentAsString();
        var runId = runResponse.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs/" + runId + "/sync"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")))
                .andExpect(jsonPath("$.message", is("中心采集执行器未配置")));

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(1)))
                .andExpect(jsonPath("$.items[0].message", is("中心采集执行器未配置")));
    }

    @Test
    void rejectsDuplicateActiveRunForSameJob() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"重复运行源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"重复运行作业\"}"))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.job_runs
                    (id, job_id, status, executor, external_id, message, submitted_at, started_at, finished_at)
                VALUES (?, ?, 'SUBMITTED', 'SEATUNNEL', 'external-active', '中心采集作业已提交', ?, ?, NULL)
                """, "active-run", jobId, now, now);

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code", is("CONFLICT")));

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs/active-run/retry"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", is("只有失败、阻塞或取消的运行记录才能重试")));
    }

    @Test
    void persistsAndUpdatesTaskConfigurationThroughPublicApi() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"配置测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "sourceId":"%s",
                                  "name":"可配置任务",
                                  "mode":"BATCH",
                                  "templateKey":"FAKE_TO_CONSOLE",
                                  "templateVersion":1,
                                  "config":{
                                    "env":{"job.mode":"BATCH","parallelism":1},
                                    "source":[{"plugin_name":"FakeSource","plugin_output":"fake","row.num":2}],
                                    "transform":[],
                                    "sink":[{"plugin_name":"Console","plugin_input":["fake"]}]
                                  }
                                }
                                """.formatted(sourceId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.configured", is(true)))
                .andExpect(jsonPath("$.templateKey", is("FAKE_TO_CONSOLE")))
                .andExpect(jsonPath("$.templateVersion", is(1)))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.templateKey", is("FAKE_TO_CONSOLE")))
                .andExpect(jsonPath("$.config.source[0].plugin_name", is("FakeSource")));

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "templateKey":"FAKE_TO_CONSOLE",
                                  "templateVersion":1,
                                  "config":{
                                    "env":{"job.mode":"BATCH","parallelism":1},
                                    "source":[{"plugin_name":"FakeSource","plugin_output":"fake","row.num":4}],
                                    "transform":[],
                                    "sink":[{"plugin_name":"Console","plugin_input":["fake"]}]
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.config.source[0]['row.num']", is(4)));

        mockMvc.perform(get("/api/v1/jobs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].configured", is(true)));
    }

    @Test
    void rejectsPlaintextSecretsInTaskConfiguration() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"敏感配置测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "sourceId":"%s",
                                  "name":"不应保存密码的任务",
                                  "templateKey":"CUSTOM_JSON",
                                  "config":{
                                    "env":{"job.mode":"BATCH"},
                                    "source":[{"plugin_name":"Jdbc" ,"password":"not-a-secret"}],
                                    "sink":[{"plugin_name":"Console"}]
                                  }
                                }
                                """.formatted(sourceId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_REQUEST")))
                .andExpect(jsonPath("$.message", is("任务配置不得保存明文密码或密钥，请改用凭据引用")));
    }

    @Test
    void rejectsInvalidTemplateVersionOnJobCreation() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"版本测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "sourceId":"%s",
                                  "name":"非法版本任务",
                                  "templateKey":"CUSTOM_JSON",
                                  "templateVersion":0,
                                  "config":{
                                    "env":{"job.mode":"BATCH"},
                                    "source":[{"plugin_name":"FakeSource"}],
                                    "sink":[{"plugin_name":"Console"}]
                                  }
                                }
                                """.formatted(sourceId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_REQUEST")))
                .andExpect(jsonPath("$.message", is("templateVersion 必须大于 0")));
    }

    @Test
    void replaysRunForSameIdempotencyKey() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"幂等测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"幂等测试任务\"}"))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var request = post("/api/v1/jobs/" + jobId + "/runs")
                .header("Idempotency-Key", "run-key-1")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}");

        var first = mockMvc.perform(request)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        var firstRunId = first.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .header("Idempotency-Key", "run-key-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", is(firstRunId)));

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .header("Idempotency-Key", "run-key-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"config\":{\"env\":{\"job.mode\":\"BATCH\"}}}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code", is("CONFLICT")));

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(1)));
    }

    @Test
    void pausesJobAndBlocksNewRunsUntilResumed() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"生命周期测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"可暂停任务\"}"))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("ACTIVE")));

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"PAUSED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("PAUSED")));

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", is("采集任务已暂停，恢复后才能启动运行")));

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("ACTIVE")));

        var keyedRun = mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .header("Idempotency-Key", "lifecycle-run-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")))
                .andReturn().getResponse().getContentAsString();
        var keyedRunId = keyedRun.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"PAUSED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("PAUSED")));

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .header("Idempotency-Key", "lifecycle-run-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", is(keyedRunId)));

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("ACTIVE")));

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")));

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ARCHIVED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("ARCHIVED")));

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message", is("采集任务已归档，不能启动运行")));

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void retriesTerminalRunWithNewRunRecord() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"重试测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"可重试任务\"}"))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var first = mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")))
                .andReturn().getResponse().getContentAsString();
        var firstRunId = first.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs/" + firstRunId + "/retry"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", org.hamcrest.Matchers.not(is(firstRunId))))
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")));

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(2)));
    }

    @Test
    void checksJdbcSourceAndPersistsHealthyResult() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"可用性测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/check")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"config\":{\"jdbcUrl\":\"jdbc:h2:mem:source-check;DB_CLOSE_DELAY=-1\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("HEALTHY")))
                .andExpect(jsonPath("$.lastCheckedAt", org.hamcrest.Matchers.notNullValue()))
                .andExpect(jsonPath("$.lastCheckMessage", is("JDBC 连接成功")));

        mockMvc.perform(get("/api/v1/sources"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].status", is("HEALTHY")))
                .andExpect(jsonPath("$.items[0].lastCheckMessage", is("JDBC 连接成功")));
    }

    @Test
    void reportsSourceCheckConfigurationFailureWithoutPretendingHealthy() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"待配置检查源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/check")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("BLOCKED_CONFIGURATION")))
                .andExpect(jsonPath("$.lastCheckMessage", is("JDBC 检查需要 jdbcUrl")));
    }

    @Test
    void checksFhirSourceThroughPublicApi() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/metadata", exchange -> {
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        try {
            var source = mockMvc.perform(post("/api/v1/sources")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"name\":\"FHIR 检查源\",\"systemType\":\"EMR\",\"protocol\":\"FHIR\"}"))
                    .andExpect(status().isCreated())
                    .andReturn().getResponse().getContentAsString();
            var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

            mockMvc.perform(post("/api/v1/sources/" + sourceId + "/check")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"config\":{\"url\":\"http://127.0.0.1:" + server.getAddress().getPort() + "/metadata\"}}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.status", is("HEALTHY")))
                    .andExpect(jsonPath("$.lastCheckMessage", is("FHIR 服务可访问（HTTP 200）")));
        } finally {
            server.stop(0);
        }
    }
}
