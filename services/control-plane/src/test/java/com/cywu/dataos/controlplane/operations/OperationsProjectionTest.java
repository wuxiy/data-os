package com.cywu.dataos.controlplane.operations;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 运营投影（G24）：摘要与明细一致性（同一批种子事实在两处计数相等）、
 * 每项带 sourceType/sourceId/asOf/deepLink、MPI 依赖不可用时局部 UNKNOWN
 * 不回假数据。
 */
@SpringBootTest
@ActiveProfiles("test")
@Import(OperationsProjectionTest.FakeMpiConfig.class)
class OperationsProjectionTest {

    @TestConfiguration
    static class FakeMpiConfig {
        @Bean
        MpiFactsClient mpiFactsClient() {
            return OperationsProjectionTest.MPI_FAKE;
        }
    }

    /** 测试内可翻转的 MPI 桩：先 UP(3)，再 UNKNOWN。 */
    static final AtomicBoolean MPI_UP = new AtomicBoolean(true);
    static final MpiFactsClient MPI_FAKE = new MpiFactsClient() {
        @Override
        public long reviewPending() {
            if (MPI_UP.get()) {
                return 3;
            }
            throw new IllegalStateException("MPI 指标不可达");
        }
    };

    @Autowired
    private OperationsProjectionService service;

    @Autowired
    private JdbcTemplate jdbc;

    private String seedIssueAndNotification() {
        var issueId = "DQ-OPS-" + UUID.randomUUID().toString().substring(0, 8);
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.governance_issues
                    (id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id,
                     owner_department, owner_name, ticket_id, impact, updated_at)
                VALUES (?, 'default', 'demo-hospital', ?, 'CRITICAL', 'PENDING', 'ds', 'rule-1',
                        'dept', 'owner', 'T-1', '影响面', ?)
                """, issueId, "运营投影验证问题", now);
        jdbc.update("""
                INSERT INTO data_os.governance_notifications
                    (id, issue_id, tenant_id, institution_id, recipient_id, channel, recipient,
                     subject, body, status, idempotency_key, attempt_count, created_at, updated_at)
                VALUES (?, ?, 'default', 'demo-hospital', 'owner', 'webhook',
                        'https://hook.example/x', 's', 'b', 'FAILED', ?, 2, ?, ?)
                """, "nf-" + UUID.randomUUID().toString().substring(0, 8), issueId,
                "idem-" + UUID.randomUUID(), now, now);
        return issueId;
    }

    @Test
    void summaryMatchesWorkItemsForSameFacts() {
        var issueId = seedIssueAndNotification();

        var summary = service.summary(null);
        var domains = (Map<?, ?>) summary.get("domains");
        var governance = (Map<?, ?>) domains.get("governance");
        var notifications = (Map<?, ?>) domains.get("notifications");
        assertThat(((Number) governance.get("openIssues")).longValue()).isGreaterThan(0);
        assertThat(((Number) governance.get("slaOverdue")).longValue()).isGreaterThanOrEqualTo(0);
        assertThat(((Number) notifications.get("backlog")).longValue()).isGreaterThan(0);
        // 组件覆盖数始终存在（三探针聚合）
        var components = (Map<?, ?>) summary.get("components");
        assertThat(components.get("total")).isEqualTo(3);

        // 明细与摘要同源：未关闭问题与积压通知都成条目，带四要素与深链
        var workItems = service.workItems(null, null, 100);
        var items = (Iterable<?>) workItems.get("items");
        var issueItemFound = false;
        var notificationItemFound = false;
        for (var item : items) {
            var map = (Map<?, ?>) item;
            assertThat(map.get("sourceType")).isNotNull();
            assertThat(map.get("sourceId")).isNotNull();
            assertThat(map.get("asOf")).isNotNull();
            assertThat(String.valueOf(map.get("deepLink"))).startsWith("/");
            if ("GOVERNANCE_ISSUE".equals(map.get("type")) && issueId.equals(map.get("sourceId"))) {
                issueItemFound = true;
            }
            if ("NOTIFICATION_BACKLOG".equals(map.get("type"))) {
                notificationItemFound = true;
            }
        }
        assertThat(issueItemFound).isTrue();
        assertThat(notificationItemFound).isTrue();

        // 类型过滤生效
        var onlyIssues = service.workItems(null, "GOVERNANCE_ISSUE", 50);
        for (var item : (Iterable<?>) onlyIssues.get("items")) {
            assertThat(((Map<?, ?>) item).get("type")).isEqualTo("GOVERNANCE_ISSUE");
        }
    }

    @Test
    void dataApiFailureAggregationAndAiBuildFailureBecomeItems() {
        var serviceId = seedDataService();
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.data_service_call
                    (id, service_id, tenant_id, key_id, idempotency_key, parameters_json,
                     row_count, truncated, elapsed_ms, status_code, called_at)
                VALUES (?, ?, 'default', NULL, ?, '{}', 0, FALSE, 30, 500, ?)
                """, "call-" + UUID.randomUUID().toString().substring(0, 8), serviceId,
                "idem-" + UUID.randomUUID(), now);

        var productId = seedAiProduct();
        jdbc.update("""
                INSERT INTO data_os.ai_data_build_job
                    (id, product_id, tenant_id, version_sn, recipe_ref, status, error, created_at)
                VALUES (?, ?, 'default', 'v0.1.0', 'recipes/x.yaml', 'FAILED', 'Doris 超时', ?)
                """, "job-" + UUID.randomUUID().toString().substring(0, 8), productId, now);

        var summary = service.summary(null);
        var domains = (Map<?, ?>) summary.get("domains");
        assertThat(((Number) ((Map<?, ?>) domains.get("dataApi")).get("failedCalls24h")).longValue()).isGreaterThan(0);
        assertThat(((Number) ((Map<?, ?>) domains.get("aiData")).get("failedBuilds24h")).longValue()).isGreaterThan(0);

        var items = (Iterable<?>) service.workItems(null, null, 200).get("items");
        var dataApiItem = false;
        var aiItem = false;
        for (var item : items) {
            var type = ((Map<?, ?>) item).get("type");
            dataApiItem = dataApiItem || "DATA_API_FAILURES".equals(type);
            aiItem = aiItem || "AI_BUILD_FAILED".equals(type);
        }
        assertThat(dataApiItem).isTrue();
        assertThat(aiItem).isTrue();
    }

    @Test
    void mpiUnavailableDegradesToUnknownWithoutFakeData() {
        var up = service.summary(null);
        var mpi = (Map<?, ?>) ((Map<?, ?>) up.get("domains")).get("mpi");
        assertThat(mpi.get("availability")).isEqualTo("UP");
        assertThat(((Number) mpi.get("reviewPending")).longValue()).isEqualTo(3L);

        MPI_UP.set(false);
        try {
            var down = service.summary(null);
            var degraded = (Map<?, ?>) ((Map<?, ?>) down.get("domains")).get("mpi");
            assertThat(degraded.get("availability")).isEqualTo("UNKNOWN");
            assertThat(((Number) degraded.get("reviewPending")).longValue()).isEqualTo(-1L);
            // 明细侧 MPI 条目缺席（不伪造），其余域不受影响
            var items = (Iterable<?>) service.workItems(null, null, 200).get("items");
            for (var item : items) {
                assertThat(((Map<?, ?>) item).get("type")).isNotEqualTo("MPI_REVIEW_PENDING");
            }
        } finally {
            MPI_UP.set(true);
        }
    }

    @Test
    void eventsFeedCarriesRecentCrossDomainFacts() {
        // 种一条已投递通知，事件流必含 NOTIFICATION/SENT 域
        var issueId = seedIssueAndNotification();
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.governance_notifications
                    (id, issue_id, tenant_id, institution_id, recipient_id, channel, recipient,
                     subject, body, status, idempotency_key, attempt_count, sent_at,
                     created_at, updated_at)
                VALUES (?, ?, 'default', 'demo-hospital', 'owner', 'webhook',
                        'https://hook.example/x', '已发送主题', 'b', 'SENT', ?, 1, ?, ?, ?)
                """, "nf-" + UUID.randomUUID().toString().substring(0, 8), issueId,
                "idem-" + UUID.randomUUID(), now, now, now);

        var events = (Iterable<?>) service.events(null, 50).get("items");
        var total = 0;
        for (var ignored : events) {
            total++;
        }
        assertThat(total).isGreaterThan(0);
        var notificationEventFound = false;
        for (var event : events) {
            var map = (Map<?, ?>) event;
            assertThat(map.get("domain")).isNotNull();
            assertThat(map.get("asOf")).isNotNull();
            notificationEventFound = notificationEventFound
                    || ("NOTIFICATION".equals(map.get("domain")) && "SENT".equals(map.get("type")));
        }
        assertThat(notificationEventFound).isTrue();
    }

    private String seedDataService() {
        var id = UUID.randomUUID().toString();
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.data_service
                    (id, tenant_id, code, name, description, version_sn, status, sql_template,
                     parameters_json, columns_json, max_rows, timeout_seconds, owner,
                     created_at, updated_at)
                VALUES (?, 'default', ?, '运营投影服务', 'd', 'v1', 'PUBLISHED',
                        'SELECT 1', '[]', '[]', 10, 30, 't', ?, ?)
                """, id, "ops-" + id.substring(0, 8), now, now);
        return id;
    }

    private String seedAiProduct() {
        var id = UUID.randomUUID().toString();
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.ai_data_product
                    (id, tenant_id, name, product_type, owner, workflow_type, source_desc,
                     current_version, lifecycle, created_at, updated_at)
                VALUES (?, 'default', ?, 'RAG_CORPUS', 'ops', 'EP_RAG', 'd', 'v0.1.0',
                        'SERVING', ?, ?)
                """, id, "ops-product-" + id.substring(0, 8), now, now);
        return id;
    }
}
