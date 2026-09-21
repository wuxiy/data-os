package com.cywu.dataos.controlplane.operations;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.operational.OperationalFactsRegistry;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 运营只读投影（G24）：不新建状态表，跨域聚合既有事实。
 * 每个投影项带 sourceType/sourceId/asOf 并给门户深链；依赖不可用（如 MPI）
 * 时局部 UNKNOWN，不回假数据。
 */
@Service
public class OperationsProjectionService {

    /** 停滞口径：SUBMITTED/RUNNING 超过 2 小时未终态。 */
    static final Duration STALLED_AFTER = Duration.ofHours(2);

    private final JdbcTemplate jdbc;
    private final TenantScope tenantScope;
    private final OperationalFactsRegistry factsRegistry;
    private final ObjectProvider<MpiFactsClient> mpiFacts;

    public OperationsProjectionService(JdbcTemplate jdbc, TenantScope tenantScope,
                                       OperationalFactsRegistry factsRegistry,
                                       ObjectProvider<MpiFactsClient> mpiFacts) {
        this.jdbc = jdbc;
        this.tenantScope = tenantScope;
        this.factsRegistry = factsRegistry;
        this.mpiFacts = mpiFacts;
    }

    // ---- summary ----

    public Map<String, Object> summary(String tenantId) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var asOf = Instant.now().toString();
        var facts = factsRegistry.snapshot();

        var domains = new LinkedHashMap<String, Object>();
        var since24h = java.sql.Timestamp.from(Instant.now().minus(Duration.ofHours(24)));
        var stalledBefore = java.sql.Timestamp.from(Instant.now().minus(STALLED_AFTER));
        domains.put("ingestion", Map.of(
                "failedRuns", count(jdbc, """
                        SELECT COUNT(*) FROM data_os.job_runs r
                        JOIN data_os.ingestion_jobs j ON j.id = r.job_id
                        JOIN data_os.sources s ON s.id = j.source_id
                        WHERE s.tenant_id = ?
                          AND r.status IN ('FAILED','SUBMIT_FAILED','BLOCKED_CONFIGURATION',
                                           'BLOCKED_DEPENDENCY','UNSUPPORTED_EXECUTOR')
                          AND r.submitted_at > ?
                        """, resolved, since24h),
                "stalledRuns", count(jdbc, """
                        SELECT COUNT(*) FROM data_os.job_runs r
                        JOIN data_os.ingestion_jobs j ON j.id = r.job_id
                        JOIN data_os.sources s ON s.id = j.source_id
                        WHERE s.tenant_id = ?
                          AND r.status IN ('SUBMITTED','RUNNING')
                          AND r.submitted_at < ?
                        """, resolved, stalledBefore)));
        domains.put("governance", Map.of(
                "openIssues", count(jdbc,
                        "SELECT COUNT(*) FROM data_os.governance_issues WHERE tenant_id = ? "
                                + "AND status <> 'CLOSED'", resolved),
                "slaOverdue", count(jdbc,
                        "SELECT COUNT(*) FROM data_os.governance_issues WHERE tenant_id = ? "
                                + "AND status = 'OVERDUE'", resolved)));
        domains.put("notifications", Map.of(
                "backlog", count(jdbc,
                        "SELECT COUNT(*) FROM data_os.governance_notifications n "
                                + "JOIN data_os.governance_issues i ON i.id = n.issue_id "
                                + "WHERE i.tenant_id = ? AND n.status IN ('PENDING','FAILED')", resolved)));
        domains.put("contracts", Map.of(
                "deliveryBacklog", count(jdbc,
                        "SELECT COUNT(*) FROM data_os.data_service_delivery "
                                + "WHERE tenant_id = ? AND status IN ('PENDING','FAILED')", resolved)));
        domains.put("mpi", mpiFactsProjection());
        domains.put("dataApi", Map.of(
                "failedCalls24h", count(jdbc,
                        "SELECT COUNT(*) FROM data_os.data_service_call WHERE tenant_id = ? "
                                + "AND status_code >= 400 AND called_at > ?", resolved, since24h)));
        domains.put("aiData", Map.of(
                "activeBuilds", count(jdbc,
                        "SELECT COUNT(*) FROM data_os.ai_data_build_job WHERE tenant_id = ? "
                                + "AND status IN ('QUEUED','RUNNING')", resolved),
                "failedBuilds24h", count(jdbc,
                        "SELECT COUNT(*) FROM data_os.ai_data_build_job WHERE tenant_id = ? "
                                + "AND status = 'FAILED' AND created_at > ?", resolved, since24h)));

        var projection = new LinkedHashMap<String, Object>();
        projection.put("asOf", asOf);
        projection.put("domains", domains);
        projection.put("components", Map.of(
                "state", facts.state().name(),
                "ready", facts.ready(), "degraded", facts.degraded(),
                "unknown", facts.unknown(), "total", facts.total()));
        projection.put("workItemsOpen", ((Number) workItems(tenantId, null, 200).get("total")).longValue());
        return projection;
    }

    /** MPI 是独立服务：客户端未配置/不可达 → UNKNOWN + null 计数（诚实，不冒充 0）。 */
    private Map<String, Object> mpiFactsProjection() {
        var client = mpiFacts.getIfAvailable();
        if (client == null) {
            return Map.of("availability", "NOT_CONFIGURED", "reviewPending", -1);
        }
        try {
            var pending = client.reviewPending();
            return Map.of("availability", "UP", "reviewPending", pending);
        } catch (RuntimeException failure) {
            return Map.of("availability", "UNKNOWN", "reviewPending", -1);
        }
    }

    // ---- work-items ----

    public Map<String, Object> workItems(String tenantId, String type, int limit) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var capped = Math.min(Math.max(limit, 1), 200);
        var items = new ArrayList<Map<String, Object>>();
        var since24h = java.sql.Timestamp.from(Instant.now().minus(Duration.ofHours(24)));
        var stalledBefore = java.sql.Timestamp.from(Instant.now().minus(STALLED_AFTER));

        // 采集失败/停滞运行
        jdbc.query("""
                SELECT r.id, j.name, r.status, r.submitted_at FROM data_os.job_runs r
                JOIN data_os.ingestion_jobs j ON j.id = r.job_id
                JOIN data_os.sources s ON s.id = j.source_id
                WHERE s.tenant_id = ?
                  AND ((r.status IN ('FAILED','SUBMIT_FAILED') AND r.submitted_at > ?)
                    OR (r.status IN ('SUBMITTED','RUNNING') AND r.submitted_at < ?))
                ORDER BY r.submitted_at DESC LIMIT 20
                """, (rs, i) -> {
            var status = rs.getString("status");
            var stalled = "SUBMITTED".equals(status) || "RUNNING".equals(status);
            items.add(item(
                    stalled ? "INGESTION_STALLED_RUN" : "INGESTION_FAILED_RUN",
                    (stalled ? "采集运行停滞" : "采集运行失败") + "：" + rs.getString("name"),
                    stalled ? "MEDIUM" : "HIGH",
                    "run", rs.getString("id"), "/ingestion",
                    rs.getTimestamp("submitted_at").toInstant().toString()));
            return null;
        }, resolved, since24h, stalledBefore);

        // 治理问题（未关闭；SLA 逾期置顶语义靠 severity=CRITICAL 表达）
        jdbc.query("""
                SELECT id, title, severity, status, updated_at FROM data_os.governance_issues
                WHERE tenant_id = ? AND status <> 'CLOSED'
                ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1
                                       WHEN 'MEDIUM' THEN 2 ELSE 3 END, due_at NULLS LAST
                LIMIT 30
                """, (rs, i) -> {
            items.add(item(
                    "GOVERNANCE_ISSUE",
                    "治理问题（" + rs.getString("status") + "）：" + rs.getString("title"),
                    rs.getString("severity"),
                    "issue", rs.getString("id"), "/governance",
                    rs.getTimestamp("updated_at").toInstant().toString()));
            return null;
        }, resolved);

        // 通知积压
        jdbc.query("""
                SELECT n.id, n.channel, n.recipient, n.status, n.updated_at,
                       n.attempt_count FROM data_os.governance_notifications n
                JOIN data_os.governance_issues i ON i.id = n.issue_id
                WHERE i.tenant_id = ? AND n.status IN ('PENDING','FAILED')
                ORDER BY n.updated_at DESC LIMIT 20
                """, (rs, i) -> {
            items.add(item(
                    "NOTIFICATION_BACKLOG",
                    "通知投递积压（" + rs.getString("channel") + " → " + rs.getString("recipient")
                            + "，已尝试 " + rs.getInt("attempt_count") + " 次）",
                    "MEDIUM",
                    "notification", rs.getString("id"), "/governance",
                    rs.getTimestamp("updated_at").toInstant().toString()));
            return null;
        }, resolved);

        // 合同投递积压
        jdbc.query("""
                SELECT d.id, s.code, d.status, d.updated_at FROM data_os.data_service_delivery d
                JOIN data_os.data_service_subscription sub ON sub.id = d.subscription_id
                JOIN data_os.data_service s ON s.id = sub.service_id
                WHERE d.tenant_id = ? AND d.status IN ('PENDING','FAILED')
                ORDER BY d.updated_at DESC LIMIT 20
                """, (rs, i) -> {
            items.add(item(
                    "CONTRACT_DELIVERY_BACKLOG",
                    "合同事件投递积压：" + rs.getString("code"),
                    "MEDIUM",
                    "delivery", rs.getString("id"), "/data-services",
                    rs.getTimestamp("updated_at").toInstant().toString()));
            return null;
        }, resolved);

        // Data API 调用失败（按服务聚合 24h）
        jdbc.query("""
                SELECT c.service_id, s.code, COUNT(*) AS failures, MAX(c.called_at) AS latest
                FROM data_os.data_service_call c
                JOIN data_os.data_service s ON s.id = c.service_id
                WHERE c.tenant_id = ? AND c.status_code >= 400 AND c.called_at > ?
                GROUP BY c.service_id, s.code
                ORDER BY failures DESC LIMIT 20
                """, (rs, i) -> {
            items.add(item(
                    "DATA_API_FAILURES",
                    "数据服务调用失败（24h " + rs.getLong("failures") + " 次）：" + rs.getString("code"),
                    "HIGH",
                    "dataService", rs.getString("service_id"), "/data-services",
                    rs.getTimestamp("latest").toInstant().toString()));
            return null;
        }, resolved, since24h);

        // AI Data 构建失败（24h）
        jdbc.query("""
                SELECT id, version_sn, error, created_at FROM data_os.ai_data_build_job
                WHERE tenant_id = ? AND status = 'FAILED' AND created_at > ?
                ORDER BY created_at DESC LIMIT 20
                """, (rs, i) -> {
            items.add(item(
                    "AI_BUILD_FAILED",
                    "AI 构建失败（" + rs.getString("version_sn") + "）：" + rs.getString("error"),
                    "MEDIUM",
                    "aiBuildJob", rs.getString("id"), "/ai-data",
                    rs.getTimestamp("created_at").toInstant().toString()));
            return null;
        }, resolved, since24h);

        // MPI 待复核（独立服务；不可用时投影缺席而非伪造）
        var mpi = mpiFacts.getIfAvailable();
        if (mpi != null) {
            try {
                var pending = mpi.reviewPending();
                if (pending > 0) {
                    items.add(item("MPI_REVIEW_PENDING",
                            "MPI 待人工复核：" + pending + " 对候选",
                            pending > 20 ? "HIGH" : "MEDIUM",
                            "mpiMetrics", "reviewPending", "/mpi", Instant.now().toString()));
                }
            } catch (RuntimeException ignored) {
                // UNKNOWN：摘要侧已呈现可用性，条目侧缺席
            }
        }

        var filtered = type == null || type.isBlank()
                ? items
                : items.stream().filter(item -> type.equals(item.get("type"))).toList();
        return Map.of("items", filtered.subList(0, Math.min(filtered.size(), capped)),
                "total", filtered.size());
    }

    // ---- events ----

    public Map<String, Object> events(String tenantId, int limit) {
        var resolved = tenantScope.resolve(tenantId, null).tenantId();
        var capped = Math.min(Math.max(limit, 1), 100);
        var events = new ArrayList<Map<String, Object>>();

        jdbc.query("""
                SELECT event_type, detail, actor, created_at FROM data_os.data_standard_event
                WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20
                """, (rs, i) -> {
            events.add(event("STANDARD", rs.getString("event_type"), rs.getString("detail"),
                    rs.getTimestamp("created_at").toInstant()));
            return null;
        }, resolved);

        jdbc.query("""
                SELECT event_type, detail, created_at FROM data_os.standard_mapping_event
                WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20
                """, (rs, i) -> {
            events.add(event("MAPPING", rs.getString("event_type"), rs.getString("detail"),
                    rs.getTimestamp("created_at").toInstant()));
            return null;
        }, resolved);

        jdbc.query("""
                SELECT service_code, change_type, from_version, to_version, created_at
                FROM data_os.data_service_contract_event
                WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20
                """, (rs, i) -> {
            events.add(event("CONTRACT", rs.getString("change_type"),
                    rs.getString("service_code") + " " + rs.getString("from_version") + " → "
                            + rs.getString("to_version"),
                    rs.getTimestamp("created_at").toInstant()));
            return null;
        }, resolved);

        jdbc.query("""
                SELECT version_sn, status, created_at, finished_at FROM data_os.ai_data_build_job
                WHERE tenant_id = ? AND status IN ('SUCCEEDED','FAILED')
                  AND COALESCE(finished_at, created_at) > ?
                ORDER BY COALESCE(finished_at, created_at) DESC LIMIT 20
                """, (rs, i) -> {
            var finished = rs.getTimestamp("finished_at");
            events.add(event("AI_BUILD", rs.getString("status"),
                    "AI 构建 " + rs.getString("version_sn") + " " + rs.getString("status"),
                    (finished == null ? rs.getTimestamp("created_at") : finished).toInstant()));
            return null;
        }, resolved, java.sql.Timestamp.from(Instant.now().minus(Duration.ofHours(48))));

        jdbc.query("""
                SELECT n.sent_at, n.subject, n.channel FROM data_os.governance_notifications n
                JOIN data_os.governance_issues i ON i.id = n.issue_id
                WHERE i.tenant_id = ? AND n.sent_at IS NOT NULL
                  AND n.sent_at > ?
                ORDER BY n.sent_at DESC LIMIT 20
                """, (rs, i) -> {
            events.add(event("NOTIFICATION", "SENT",
                    "[" + rs.getString("channel") + "] " + rs.getString("subject"),
                    rs.getTimestamp("sent_at").toInstant()));
            return null;
        }, resolved, java.sql.Timestamp.from(Instant.now().minus(Duration.ofHours(48))));

        events.sort((left, right) -> String.valueOf(right.get("asOf")).compareTo(String.valueOf(left.get("asOf"))));
        return Map.of("items", events.subList(0, Math.min(events.size(), capped)),
                "total", events.size());
    }

    // ---- 形状 ----

    private static Map<String, Object> item(String type, String title, String severity,
                                            String sourceType, String sourceId,
                                            String deepLink, String asOf) {
        return Map.of("type", type, "title", title,
                "severity", severity == null || severity.isBlank() ? "LOW" : severity,
                "sourceType", sourceType, "sourceId", sourceId,
                "deepLink", deepLink, "asOf", asOf);
    }

    private static Map<String, Object> event(String domain, String type, String detail, Instant at) {
        return Map.of("domain", domain, "type", type, "detail", detail,
                "asOf", at.toString());
    }

    private static long count(JdbcTemplate jdbc, String sql, Object... args) {
        var found = jdbc.queryForObject(sql, Long.class, args);
        return found == null ? 0 : found;
    }
}
