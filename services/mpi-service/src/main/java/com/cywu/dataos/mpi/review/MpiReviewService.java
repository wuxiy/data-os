package com.cywu.dataos.mpi.review;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.cywu.dataos.mpi.audit.MpiAuditEvents;
import com.cywu.dataos.mpi.audit.MpiAuditService;
import com.cywu.dataos.mpi.person.MpiPersonService;

/**
 * 人工复核闭环：SAME_PERSON 确认同人（必要时并黄金人，决策源 MANUAL）、
 * DIFFERENT_PERSON 确认不同人（终态否决，下轮 H-ep1 拦截）。决策全程
 * 落审计；任务终态后不可重复决策。
 */
@Service
@ConditionalOnProperty(name = "data-os.mpi.doris.url")
public class MpiReviewService {

    private final JdbcTemplate pg;
    private final JdbcTemplate doris;
    private final MpiPersonService persons;
    private final MpiAuditService audit;

    public MpiReviewService(JdbcTemplate pg, @Qualifier("dorisJdbc") JdbcTemplate doris,
                            MpiPersonService persons, MpiAuditService audit) {
        this.pg = pg;
        this.doris = doris;
        this.persons = persons;
        this.audit = audit;
    }

    @Transactional
    public Map<String, Object> resolve(String tenantId, String institutionId, String taskId,
                                       String resolution, String reason, String actor) {
        if (!"SAME_PERSON".equals(resolution) && !"DIFFERENT_PERSON".equals(resolution)) {
            throw new IllegalArgumentException("resolution 仅允许 SAME_PERSON / DIFFERENT_PERSON");
        }
        var task = pg.queryForMap("""
                SELECT pair_id, status FROM data_os_mpi.mpi_review_task
                WHERE tenant_id = ? AND id = ?
                """, tenantId, taskId);
        if (!"OPEN".equals(task.get("STATUS")) && !"DEFERRED".equals(task.get("STATUS"))) {
            throw new IllegalStateException("复核任务已裁决，不能重复决策");
        }
        var pair = doris.queryForMap("""
                SELECT identity_a, identity_b FROM dataos_mpi.mpi_candidate_pair
                WHERE tenant_id = ? AND pair_id = ?
                """, tenantId, ((Number) task.get("PAIR_ID")).longValue());
        var identityA = String.valueOf(pair.get("IDENTITY_A"));
        var identityB = String.valueOf(pair.get("IDENTITY_B"));

        String mergedPersonId = null;
        if ("SAME_PERSON".equals(resolution)) {
            mergedPersonId = persons.uniteManual(tenantId, institutionId, identityA, identityB, actor);
        }
        pg.update("""
                UPDATE data_os_mpi.mpi_review_task
                SET status = 'RESOLVED', resolution = ?, reason = ?, resolved_by = ?,
                    resolved_at = CURRENT_TIMESTAMP
                WHERE tenant_id = ? AND id = ?
                """, resolution, reason, actor, tenantId, taskId);
        MpiAuditEvents.decision(audit, tenantId, institutionId, taskId, resolution,
                ((Number) task.get("PAIR_ID")).longValue(), List.of(identityA, identityB),
                mergedPersonId, actor, reason);
        return Map.of("taskId", taskId, "resolution", resolution,
                "mergedPersonId", mergedPersonId == null ? "" : mergedPersonId);
    }
}
