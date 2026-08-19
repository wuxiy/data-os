package com.cywu.dataos.mpi.review;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.cywu.dataos.mpi.matcher.MpiRuleMatcher;

/**
 * 复核工作台查询：候选任务列表（PG 任务 + Doris 双侧身份/证据拼装）、
 * pair explain、黄金人详情与操作历史。展示层纪律：卡号掩码、联系方式
 * 只显示一致性结论、姓名/性别/年龄明文（工作台必需字段）。
 */
@Service
@ConditionalOnProperty(name = "data-os.mpi.doris.url")
public class MpiReviewQueryService {

    private final JdbcTemplate pg;
    private final JdbcTemplate doris;

    public MpiReviewQueryService(JdbcTemplate pg, @Qualifier("dorisJdbc") JdbcTemplate doris) {
        this.pg = pg;
        this.doris = doris;
    }

    /** 复核任务分页列表（status 默认 OPEN）。 */
    public Map<String, Object> candidates(String tenantId, String status, int page, int size) {
        var effectiveStatus = status == null || status.isBlank() ? "OPEN" : status.toUpperCase();
        var total = pg.queryForObject("""
                SELECT COUNT(*) FROM data_os_mpi.mpi_review_task
                WHERE tenant_id = ? AND status = ?
                """, Integer.class, tenantId, effectiveStatus);
        var offset = Math.max(0, page - 1) * size;
        var tasks = pg.queryForList("""
                SELECT id, pair_id, status, resolution, created_at, resolved_by, resolved_at
                FROM data_os_mpi.mpi_review_task
                WHERE tenant_id = ? AND status = ?
                ORDER BY created_at ASC LIMIT ? OFFSET ?
                """, tenantId, effectiveStatus, size, offset);

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
        return Map.of("total", total == null ? 0 : total, "page", page, "size", size, "items", items);
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
                  AND CONCAT(institution_code, '|', source_system, '|', source_key) = ?
                """, tenantId, identityGroup);
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
