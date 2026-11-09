package com.cywu.dataos.mpi.review;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.cywu.dataos.mpi.identity.SourceIdentity;
import com.cywu.dataos.mpi.matcher.MpiRuleMatcher;

/**
 * 复核工作台查询：候选任务列表（PG 任务 + Doris 双侧身份/证据拼装）、
 * pair explain、黄金人详情与操作历史。展示层纪律：卡号掩码、联系方式
 * 只显示一致性结论、姓名/性别/年龄明文（工作台必需字段）。
 */
@Service
@ConditionalOnProperty(name = "data-os.mpi.doris.url")
public class MpiReviewQueryService {

    private static final String IDENTITY_PROJECTION = SourceIdentity.sqlProjection(null);

    private final JdbcTemplate pg;
    private final JdbcTemplate doris;

    public MpiReviewQueryService(JdbcTemplate pg, @Qualifier("dorisJdbc") JdbcTemplate doris) {
        this.pg = pg;
        this.doris = doris;
    }

    /**
     * 复核任务分页列表（status 默认 OPEN）。
     * q 非空时按姓名/卡号/规则编号在双侧身份与匹配结果上服务端过滤——
     * 队列按 size 截断装载，客户端过滤会对窗口外的候选给出假阴性
     * （2026-11-09 走查 P1）。
     */
    public Map<String, Object> candidates(String tenantId, String status, String q, int page, int size) {
        var effectiveStatus = status == null || status.isBlank() ? "OPEN" : status.toUpperCase();
        var keyword = q == null ? "" : q.trim();
        var matchedPairIds = keyword.isEmpty() ? null : matchingPairIds(tenantId, keyword);

        var total = matchedPairIds == null
                ? pg.queryForObject("""
                        SELECT COUNT(*) FROM data_os_mpi.mpi_review_task
                        WHERE tenant_id = ? AND status = ?
                        """, Integer.class, tenantId, effectiveStatus)
                : matchedPairIds.isEmpty() ? 0
                : pg.queryForObject(countTasksInPairsSql(matchedPairIds.size()), totalArgs(tenantId, effectiveStatus, matchedPairIds), Integer.class);
        var offset = Math.max(0, page - 1) * size;
        var tasks = matchedPairIds == null
                ? pg.queryForList("""
                        SELECT id, pair_id, status, resolution, created_at, resolved_by, resolved_at
                        FROM data_os_mpi.mpi_review_task
                        WHERE tenant_id = ? AND status = ?
                        ORDER BY created_at ASC LIMIT ? OFFSET ?
                        """, tenantId, effectiveStatus, size, offset)
                : matchedPairIds.isEmpty()
                        ? List.<Map<String, Object>>of()
                        : pg.queryForList(pageTasksInPairsSql(matchedPairIds.size(), size, offset), pageArgs(tenantId, effectiveStatus, matchedPairIds));

        List<Map<String, Object>> items = new ArrayList<>();
        for (var task : tasks) {
            var pairId = ((Number) task.get("PAIR_ID")).longValue();
            var match = doris.queryForMap("""
                    SELECT r.rule_id, r.outcome, r.evidence, p.identity_a, p.identity_b
                    FROM dataos_mpi.mpi_match_result r
                    JOIN dataos_mpi.mpi_candidate_pair p
                      ON p.tenant_id = r.tenant_id AND p.pair_id = r.pair_id
                    WHERE r.tenant_id = ? AND r.pair_id = ?
                    """, tenantId, pairId);
            items.add(Map.of(
                    "taskId", task.get("ID"),
                    "pairId", pairId,
                    "status", task.get("STATUS"),
                    "createdAt", String.valueOf(task.get("CREATED_AT")),
                    "ruleId", match.get("RULE_ID"),
                    "outcome", match.get("OUTCOME"),
                    "identityA", identityView(tenantId, String.valueOf(match.get("IDENTITY_A"))),
                    "identityB", identityView(tenantId, String.valueOf(match.get("IDENTITY_B"))),
                    "evidence", String.valueOf(match.get("EVIDENCE"))));
        }
        return Map.of("total", total, "page", page, "size", size, "items", items);
    }

    /** 关键词在 Doris 侧命中的 pair（双侧姓名/卡号或规则编号包含匹配）。 */
    private List<Long> matchingPairIds(String tenantId, String keyword) {
        var like = "%" + keyword + "%";
        var rows = doris.queryForList("""
                SELECT DISTINCT p.pair_id
                FROM dataos_mpi.mpi_candidate_pair p
                JOIN dataos_mpi.mpi_match_result r
                  ON r.tenant_id = p.tenant_id AND r.pair_id = p.pair_id
                LEFT JOIN dataos_mpi.mpi_source_identity a
                  ON a.tenant_id = p.tenant_id AND %s = p.identity_a
                LEFT JOIN dataos_mpi.mpi_source_identity b
                  ON b.tenant_id = p.tenant_id AND %s = p.identity_b
                WHERE p.tenant_id = ?
                  AND (r.rule_id LIKE ? OR a.name_norm LIKE ? OR a.card_no_norm LIKE ?
                       OR b.name_norm LIKE ? OR b.card_no_norm LIKE ?)
                """.formatted(SourceIdentity.sqlProjection("a"), SourceIdentity.sqlProjection("b")),
                tenantId, like, like, like, like, like);
        return rows.stream().map(row -> ((Number) row.get("PAIR_ID")).longValue()).toList();
    }

    private static String countTasksInPairsSql(int pairCount) {
        return """
                SELECT COUNT(*) FROM data_os_mpi.mpi_review_task
                WHERE tenant_id = ? AND status = ? AND pair_id IN (%s)
                """.formatted(placeholders(pairCount));
    }

    private static String pageTasksInPairsSql(int pairCount, int limit, int offset) {
        return """
                SELECT id, pair_id, status, resolution, created_at, resolved_by, resolved_at
                FROM data_os_mpi.mpi_review_task
                WHERE tenant_id = ? AND status = ? AND pair_id IN (%s)
                ORDER BY created_at ASC LIMIT %d OFFSET %d
                """.formatted(placeholders(pairCount), limit, offset);
    }

    private static Object[] totalArgs(String tenantId, String status, List<Long> pairIds) {
        var args = new ArrayList<Object>();
        args.add(tenantId);
        args.add(status);
        args.addAll(pairIds);
        return args.toArray();
    }

    private static Object[] pageArgs(String tenantId, String status, List<Long> pairIds) {
        return totalArgs(tenantId, status, pairIds);
    }

    private static String placeholders(int count) {
        return String.join(",", java.util.Collections.nCopies(count, "?"));
    }

    /** Explain：任一 pair 的命中规则与逐字段证据（验收 #7）。 */
    public Map<String, Object> explain(String tenantId, long pairId) {
        var match = doris.queryForMap("""
                SELECT r.rule_id, r.rule_version, r.outcome, r.evidence, p.identity_a, p.identity_b
                FROM dataos_mpi.mpi_match_result r
                JOIN dataos_mpi.mpi_candidate_pair p
                  ON p.tenant_id = r.tenant_id AND p.pair_id = r.pair_id
                WHERE r.tenant_id = ? AND r.pair_id = ?
                """, tenantId, pairId);
        return Map.of(
                "pairId", pairId,
                "ruleId", match.get("RULE_ID"),
                "ruleVersion", match.get("RULE_VERSION"),
                "outcome", match.get("OUTCOME"),
                "evidence", String.valueOf(match.get("EVIDENCE")),
                "identityA", identityView(tenantId, String.valueOf(match.get("IDENTITY_A"))),
                "identityB", identityView(tenantId, String.valueOf(match.get("IDENTITY_B"))));
    }

    /** 黄金人详情：属性 + 身份链接 + 操作历史（最近 20 条）。列名统一驼峰别名（前端契约）。 */
    public Map<String, Object> person(String tenantId, String personId) {
        var person = pg.queryForMap("""
                SELECT id, golden_name, golden_gender, status, created_at, updated_at
                FROM data_os_mpi.mpi_person WHERE tenant_id = ? AND id = ?
                """, tenantId, personId);
        var links = pg.queryForList("""
                SELECT source_identifier AS "sourceIdentifier",
                       decision_source AS "decisionSource",
                       link_status AS "linkStatus",
                       valid_from AS "validFrom"
                FROM data_os_mpi.mpi_person_link
                WHERE tenant_id = ? AND person_id = ? AND valid_to IS NULL
                ORDER BY valid_from DESC
                """, tenantId, personId);
        var history = pg.queryForList("""
                SELECT action AS "action", actor AS "actor", detail AS "detail",
                       created_at AS "createdAt"
                FROM data_os_mpi.mpi_audit_event
                WHERE tenant_id = ? AND (subject_id = ? OR detail LIKE ?)
                ORDER BY created_at DESC LIMIT 20
                """, tenantId, personId, "%" + personId + "%");
        return Map.of(
                "id", person.get("ID"),
                "goldenName", person.get("GOLDEN_NAME"),
                "goldenGender", person.get("GOLDEN_GENDER") == null ? "" : person.get("GOLDEN_GENDER"),
                "status", person.get("STATUS"),
                "createdAt", String.valueOf(person.get("CREATED_AT")),
                "links", links,
                "history", history);
    }

    /** 身份展示视图：卡号/患者主键掩码，联系方式只给一致性占位。 */
    private Map<String, Object> identityView(String tenantId, String identityGroup) {
        var row = doris.queryForMap("""
                SELECT institution_code, source_system, patient_id, card_no_norm, name_norm,
                       gender, age_display
                FROM dataos_mpi.mpi_source_identity
                WHERE tenant_id = ?
                  AND %s = ?
                """.formatted(IDENTITY_PROJECTION), tenantId, identityGroup);
        return Map.of(
                "identity", identityGroup,
                "institution", row.get("INSTITUTION_CODE"),
                "sourceSystem", row.get("SOURCE_SYSTEM"),
                "patientId", mask(String.valueOf(row.get("PATIENT_ID"))),
                "cardNo", row.get("CARD_NO_NORM") == null ? ""
                        : MpiRuleMatcher.maskCard(String.valueOf(row.get("CARD_NO_NORM"))),
                "name", row.get("NAME_NORM") == null ? "" : row.get("NAME_NORM"),
                "gender", row.get("GENDER") == null ? "" : row.get("GENDER"),
                "age", row.get("AGE_DISPLAY") == null ? "" : row.get("AGE_DISPLAY"));
    }

    private static String mask(String value) {
        if (value == null || value.length() <= 2) return "***";
        return value.charAt(0) + "***" + value.charAt(value.length() - 1);
    }
}
