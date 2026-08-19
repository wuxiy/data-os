package com.cywu.dataos.mpi.review;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
            mergedPersonId = uniteIdentities(tenantId, institutionId, identityA, identityB, actor);
        }
        pg.update("""
                UPDATE data_os_mpi.mpi_review_task
                SET status = 'RESOLVED', resolution = ?, reason = ?, resolved_by = ?,
                    resolved_at = CURRENT_TIMESTAMP
                WHERE tenant_id = ? AND id = ?
                """, resolution, reason, actor, tenantId, taskId);
        audit.append(tenantId, institutionId, "DECISION", actor, "USER", "REVIEW_TASK", taskId,
                Map.of("resolution", resolution,
                        "pairId", ((Number) task.get("PAIR_ID")).longValue(),
                        "identities", List.of(identityA, identityB),
                        "mergedPersonId", mergedPersonId == null ? "" : mergedPersonId,
                        "reason", reason == null ? "" : reason),
                null);
        return Map.of("taskId", taskId, "resolution", resolution,
                "mergedPersonId", mergedPersonId == null ? "" : mergedPersonId);
    }

    /** 把两个身份归入同一黄金人（人工路径）：复用 person 服务的链接语义。 */
    private String uniteIdentities(String tenantId, String institutionId,
                                   String identityA, String identityB, String actor) {
        var personA = currentPerson(tenantId, identityA);
        var personB = currentPerson(tenantId, identityB);
        if (personA.isPresent() && personA.equals(personB)) {
            return personA.get();
        }
        String personId;
        if (personA.isEmpty() && personB.isEmpty()) {
            personId = createManualPerson(tenantId, institutionId, identityA);
        } else if (personA.isPresent() && personB.isEmpty()) {
            personId = personA.get();
        } else if (personA.isEmpty()) {
            personId = personB.get();
        } else {
            personId = personA.get();
            persons.mergePersons(tenantId, institutionId, personA.get(), personB.get(),
                    "MANUAL", actor, "人工复核确认同人");
        }
        persons.linkManual(tenantId, institutionId, personId, identityA, actor);
        persons.linkManual(tenantId, institutionId, personId, identityB, actor);
        return personId;
    }

    private String createManualPerson(String tenantId, String institutionId, String identityGroup) {
        var name = doris.queryForObject("""
                SELECT name_norm FROM dataos_mpi.mpi_source_identity
                WHERE tenant_id = ?
                  AND CONCAT(institution_code, '|', source_system, '|', source_key) = ?
                """, String.class, tenantId, identityGroup);
        return persons.createManualPerson(tenantId, institutionId, name);
    }

    private java.util.Optional<String> currentPerson(String tenantId, String identityGroup) {
        var found = pg.queryForList("""
                SELECT person_id FROM data_os_mpi.mpi_person_link
                WHERE tenant_id = ? AND source_identifier = ? AND valid_to IS NULL
                  AND link_status = 'ACTIVE'
                """, String.class, tenantId, identityGroup);
        if (found.isEmpty()) return java.util.Optional.empty();
        if (found.size() > 1) {
            throw new IllegalStateException("身份存在多条有效链接（数据一致性违规）");
        }
        return java.util.Optional.of(found.get(0));
    }
}
