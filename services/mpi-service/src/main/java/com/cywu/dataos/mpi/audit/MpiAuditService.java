package com.cywu.dataos.mpi.audit;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 不可变审计事件（PG data_os_mpi.mpi_audit_event，只追加），
 * 兼任 Hard Constraint 的事实来源：
 * - H-ep1：复核任务已判 DIFFERENT_PERSON 的 pair 再次候选；
 * - H-ep2：SPLIT 事件中同时出现的身份对再次候选。
 * 人工否决高于任何规则与分数。
 */
@Service
public class MpiAuditService {

    private final JdbcTemplate pg;
    private final ObjectMapper objectMapper;

    public MpiAuditService(JdbcTemplate pg, ObjectMapper objectMapper) {
        this.pg = pg;
        this.objectMapper = objectMapper;
    }

    public void append(String tenantId, String institutionId, String action, String actor, String actorType,
                       String subjectType, String subjectId, Object detail, String ruleVersion) {
        try {
            pg.update("""
                    INSERT INTO data_os_mpi.mpi_audit_event
                      (id, tenant_id, institution_id, action, actor, actor_type, subject_type, subject_id,
                       detail, rule_version, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """, UUID.randomUUID().toString(), tenantId, institutionId, action, actor, actorType,
                    subjectType, subjectId, objectMapper.writeValueAsString(detail), ruleVersion);
        } catch (Exception exception) {
            throw new IllegalStateException("审计事件写入失败：" + action, exception);
        }
    }

    /** H-ep1：该 pair 是否已被人工判定为不同人（终态否决）。 */
    public boolean rejectedAsDifferentPerson(String tenantId, long pairId) {
        var count = pg.queryForObject("""
                SELECT COUNT(*) FROM data_os_mpi.mpi_review_task
                WHERE tenant_id = ? AND pair_id = ? AND resolution = 'DIFFERENT_PERSON'
                """, Integer.class, tenantId, pairId);
        return count != null && count > 0;
    }

    /** H-ep2：两个身份是否曾在同一黄金人下被人工拆开（同一次 SPLIT 事件的分离集合）。 */
    public boolean separatedBySplit(String tenantId, String identityA, String identityB) {
        List<String> details = pg.queryForList("""
                SELECT detail FROM data_os_mpi.mpi_audit_event
                WHERE tenant_id = ? AND action = 'SPLIT'
                """, String.class, tenantId);
        for (String detail : details) {
            try {
                var separated = (List<?>) objectMapper.readValue(detail, Map.class)
                        .get(MpiAuditEvents.KEY_SEPARATED_IDENTITIES);
                if (separated != null && separated.contains(identityA) && separated.contains(identityB)) {
                    return true;
                }
            } catch (Exception ignored) {
                // 历史异常数据不阻断匹配：跳过该条（审计只读，不修复）。
            }
        }
        return false;
    }
}
