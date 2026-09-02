package com.cywu.dataos.mpi.person;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.cywu.dataos.mpi.audit.MpiAuditEvents;
import com.cywu.dataos.mpi.audit.MpiAuditService;
import com.cywu.dataos.mpi.identity.SourceIdentity;

/**
 * 黄金人生命周期：AUTO 建人/并人（规则置信内）、人工 Merge、Split。
 * 归并格子（建人/收编/幂等/并人）的单一属主：RULE 与 MANUAL 两个人口
 * 共用 unite(...)，链接与 Doris 投影回写只在这里发生。并人赢家统一为
 * earlierOf（2026-09-02 决策：与入口/方向无关的确定不变量）；两侧仍经
 * UnitePlan 显式声明的是决策元数据与建人属性来源（先例：
 * ExternalRunLifecycle 的 RunPolicy）。
 * V1 说明：M 级规则按 pair 逐对应用，同卡同名链自然连通为一个黄金人；
 * 传递闭包冲突检测（Cluster Guard 完整版）留 V2，此处以「弱标识不单独
 * 硬合并」的规则纪律兜底。link 为版本链（valid_to 关闭即失效），
 * Merge/Split 均可逆且留审计；身份标识以 source_identifier
 * （机构|源系统|源主键）存储。
 */
@Service
public class MpiPersonService {

    private static final String IDENTITY_PROJECTION = SourceIdentity.sqlProjection(null);

    private final JdbcTemplate pg;
    private final JdbcTemplate doris;
    private final MpiAuditService audit;

    public MpiPersonService(JdbcTemplate pg, @Qualifier("dorisJdbc") JdbcTemplate doris,
                            MpiAuditService audit) {
        this.pg = pg;
        this.doris = doris;
        this.audit = audit;
    }

    /** 规则 AUTO_MATCH 的应用：把两个源身份归入同一黄金人（幂等）。 */
    @Transactional
    public void applyAutoMatch(String tenantId, String institutionId, long pairId,
                               String identityA, String identityB, String name, String gender,
                               String ruleId, String ruleVersion) {
        var outcome = unite(tenantId, institutionId, identityA, identityB, new UnitePlan(
                "RULE", "system", ruleVersion, name, gender, "system",
                "AUTO_MATCH 规则并人：" + ruleId));
        if (outcome.alreadyUnited()) {
            // 幂等早退不追加审计：全量重算会重复经过已决对。
            return;
        }
        MpiAuditEvents.autoMatch(audit, tenantId, institutionId, pairId, ruleId,
                outcome.personId(), List.of(identityA, identityB), ruleVersion);
    }

    /** 人工复核 SAME_PERSON：把两个身份归入同一黄金人（决策源 MANUAL，幂等）。 */
    @Transactional
    public String uniteManual(String tenantId, String institutionId,
                              String identityA, String identityB, String actor) {
        return unite(tenantId, institutionId, identityA, identityB, new UnitePlan(
                "MANUAL", actor, null, nameOf(tenantId, identityA), null,
                "manual", "人工复核确认同人")).personId();
    }

    /**
     * 归并格子：双方无链接→建人 / 一方有→收编 / 已同人→幂等补投影 /
     * 双方各有→并人。**并人统一保留创建较早者**（earlierOf，与发起方向
     * 无关的确定不变量——决策 2026-09-02：RULE/MANUAL 赢家规则统一；
     * 操作者要显式指定存活者走 MpiPersonController 的 keep/drop 合并端点）。
     * 两侧仍声明的是决策元数据与建人属性来源。
     */
    private UniteOutcome unite(String tenantId, String institutionId,
                               String identityA, String identityB, UnitePlan plan) {
        var personA = currentPersonOf(tenantId, identityA);
        var personB = currentPersonOf(tenantId, identityB);
        if (personA.isPresent() && personA.equals(personB)) {
            // 已同人：rebuild 幂等路径。装载阶段全量重装会重置回写列，
            // 此处必须补投影回写（identity→person 的缓存视图随时可重建）。
            writeBackPersonId(tenantId, personA.get(), identityA, identityB);
            return new UniteOutcome(personA.get(), true);
        }
        String personId;
        if (personA.isEmpty() && personB.isEmpty()) {
            personId = createPerson(tenantId, institutionId,
                    plan.newPersonName(), plan.newPersonGender(), plan.newPersonCreatedBy());
        } else if (personA.isPresent() && personB.isEmpty()) {
            personId = personA.get();
        } else if (personA.isEmpty()) {
            personId = personB.get();
        } else {
            personId = earlierOf(tenantId, personA.get(), personB.get());
            var dropped = personId.equals(personA.get()) ? personB.get() : personA.get();
            mergePersons(tenantId, institutionId, personId, dropped,
                    plan.decisionSource(), plan.actor(), plan.mergeReason());
        }
        insertLink(tenantId, institutionId, personId, identityA,
                plan.decisionSource(), plan.ruleVersion(), plan.actor());
        insertLink(tenantId, institutionId, personId, identityB,
                plan.decisionSource(), plan.ruleVersion(), plan.actor());
        writeBackPersonId(tenantId, personId, identityA, identityB);
        return new UniteOutcome(personId, false);
    }

    /** 人工/规则合并：drop 的全部有效身份改挂 keep，drop 归档为 MERGED。 */
    @Transactional
    public void mergePersons(String tenantId, String institutionId, String keepId, String dropId,
                             String decisionSource, String actor, String reason) {
        if (keepId.equals(dropId)) {
            throw new IllegalArgumentException("不能合并同一黄金人");
        }
        var movingIdentities = pg.queryForList("""
                SELECT source_identifier FROM data_os_mpi.mpi_person_link
                WHERE tenant_id = ? AND person_id = ? AND valid_to IS NULL AND link_status = 'ACTIVE'
                """, String.class, tenantId, dropId);
        if (movingIdentities.isEmpty()) {
            throw new IllegalArgumentException("被合并黄金人没有有效身份链接");
        }
        pg.update("""
                UPDATE data_os_mpi.mpi_person_link
                SET valid_to = CURRENT_TIMESTAMP, link_status = 'MERGED'
                WHERE tenant_id = ? AND person_id = ? AND valid_to IS NULL
                """, tenantId, dropId);
        for (var identityGroup : movingIdentities) {
            insertLink(tenantId, institutionId, keepId, identityGroup, decisionSource, null, actor);
        }
        pg.update("UPDATE data_os_mpi.mpi_person SET status = 'MERGED', updated_at = CURRENT_TIMESTAMP"
                + " WHERE tenant_id = ? AND id = ?", tenantId, dropId);
        for (var group : movingIdentities) {
            writeBackPersonId(tenantId, keepId, group);
        }
        if ("MANUAL".equals(decisionSource)) {
            MpiAuditEvents.merge(audit, tenantId, institutionId, keepId, dropId,
                    movingIdentities, actor, reason);
        }
    }

    /** 人工拆分：把一个身份从黄金人拆出为独立人，并记录否决集合（H-ep2 事实源）。 */
    @Transactional
    public String splitIdentity(String tenantId, String institutionId, String personId,
                                String identityGroup, String actor, String reason) {
        var linkExists = pg.queryForObject("""
                SELECT COUNT(*) FROM data_os_mpi.mpi_person_link
                WHERE tenant_id = ? AND person_id = ? AND source_identifier = ?
                  AND valid_to IS NULL AND link_status = 'ACTIVE'
                """, Integer.class, tenantId, personId, identityGroup);
        if (linkExists == null || linkExists == 0) {
            throw new IllegalArgumentException("该身份不在指定黄金人的有效链接中");
        }
        var remaining = pg.queryForList("""
                SELECT source_identifier FROM data_os_mpi.mpi_person_link
                WHERE tenant_id = ? AND person_id = ? AND valid_to IS NULL AND link_status = 'ACTIVE'
                  AND source_identifier <> ?
                """, String.class, tenantId, personId, identityGroup);
        pg.update("""
                UPDATE data_os_mpi.mpi_person_link
                SET valid_to = CURRENT_TIMESTAMP, link_status = 'SPLIT'
                WHERE tenant_id = ? AND person_id = ? AND source_identifier = ? AND valid_to IS NULL
                """, tenantId, personId, identityGroup);
        var name = nameOf(tenantId, identityGroup);
        var newPersonId = createPerson(tenantId, institutionId, name, null, actor);
        insertLink(tenantId, institutionId, newPersonId, identityGroup, "MANUAL", null, actor);
        writeBackPersonId(tenantId, newPersonId, identityGroup);
        // 否决集合 = 被拆身份与原黄金人剩余身份：这些组合永不再自动合并（H-ep2）。
        var separated = new ArrayList<String>();
        separated.add(identityGroup);
        separated.addAll(remaining);
        MpiAuditEvents.split(audit, tenantId, institutionId, personId, separated,
                newPersonId, identityGroup, actor, reason);
        return newPersonId;
    }

    private Optional<String> currentPersonOf(String tenantId, String identityGroup) {
        var found = pg.queryForList("""
                SELECT person_id FROM data_os_mpi.mpi_person_link
                WHERE tenant_id = ? AND source_identifier = ? AND valid_to IS NULL
                  AND link_status = 'ACTIVE'
                """, String.class, tenantId, identityGroup);
        if (found.isEmpty()) return Optional.empty();
        if (found.size() > 1) {
            throw new IllegalStateException("身份 " + identityGroup + " 存在多条有效链接（数据一致性违规）");
        }
        return Optional.of(found.get(0));
    }

    private String createPerson(String tenantId, String institutionId, String name, String gender,
                                String createdBy) {
        var id = UUID.randomUUID().toString();
        pg.update("""
                INSERT INTO data_os_mpi.mpi_person
                  (id, tenant_id, institution_id, golden_name, golden_gender, status, created_by,
                   created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, id, tenantId, institutionId, name == null ? "未知" : name, gender, createdBy);
        return id;
    }

    /** 版本链插入：先关闭该身份的旧有效链接，再挂新链接（identityGroup=源系统|源键）。 */
    private void insertLink(String tenantId, String institutionId, String personId, String identityGroup,
                            String decisionSource, String ruleVersion, String actor) {
        pg.update("""
                UPDATE data_os_mpi.mpi_person_link
                SET valid_to = CURRENT_TIMESTAMP
                WHERE tenant_id = ? AND source_identifier = ? AND valid_to IS NULL
                """, tenantId, identityGroup);
        var sourceSystem = SourceIdentity.parse(identityGroup).sourceSystem();
        pg.update("""
                INSERT INTO data_os_mpi.mpi_person_link
                  (id, tenant_id, institution_id, person_id, source_system, source_identifier,
                   link_status, decision_source, rule_version, valid_from, valid_to, created_by)
                VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, CURRENT_TIMESTAMP, NULL, ?)
                """, UUID.randomUUID().toString(), tenantId, institutionId, personId, sourceSystem,
                identityGroup, decisionSource, ruleVersion, actor);
    }

    private String earlierOf(String tenantId, String first, String second) {
        return pg.queryForObject("""
                SELECT id FROM data_os_mpi.mpi_person
                WHERE tenant_id = ? AND id IN (?, ?) AND status = 'ACTIVE'
                ORDER BY created_at ASC, id ASC LIMIT 1
                """, String.class, tenantId, first, second);
    }

    private String nameOf(String tenantId, String identityGroup) {
        return doris.queryForObject("""
                SELECT name_norm FROM dataos_mpi.mpi_source_identity
                WHERE tenant_id = ?
                  AND %s = ?
                """.formatted(IDENTITY_PROJECTION), String.class, tenantId, identityGroup);
    }

    private void writeBackPersonId(String tenantId, String personId, String... identityGroups) {
        for (var group : identityGroups) {
            doris.update("""
                    UPDATE dataos_mpi.mpi_source_identity
                    SET mpi_person_id = ?
                    WHERE tenant_id = ?
                      AND %s = ?
                    """.formatted(IDENTITY_PROJECTION), personId, tenantId, group);
        }
    }

    /** 两侧归并差异的显式声明：决策元数据与建人属性来源（并人保谁已统一 earlierOf）。 */
    private record UnitePlan(String decisionSource, String actor, String ruleVersion,
                             String newPersonName, String newPersonGender,
                             String newPersonCreatedBy, String mergeReason) {}

    /** 归并结果：存活黄金人 + 是否幂等早退（已同人，未产生新链接/审计）。 */
    private record UniteOutcome(String personId, boolean alreadyUnited) {}
}
