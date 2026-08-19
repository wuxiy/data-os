package com.cywu.dataos.mpi.decision;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import com.cywu.dataos.mpi.candidate.MpiBlockingService;
import com.cywu.dataos.mpi.load.MpiLoaderService;
import com.cywu.dataos.mpi.person.MpiPersonService;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 决策全流程（H2 双侧真 SQL）：装载→召回→三态落库 + AUTO 建人 +
 * REVIEW 建任务 + 幂等重算 + H-ep1/H-ep2 硬冲突拦截（人工否决高于规则）。
 */
@ActiveProfiles("test")
@SpringBootTest
@Sql("/mpi-doris-test-schema.sql")
class MpiDecisionFlowTests {

    @Autowired
    @Qualifier("dorisJdbc")
    private JdbcTemplate doris;

    @Autowired
    private JdbcTemplate pg;

    @Autowired
    private MpiLoaderService loader;

    @Autowired
    private MpiBlockingService blocking;

    @Autowired
    private MpiDecisionService decisions;

    @Autowired
    private MpiPersonService persons;

    @BeforeEach
    void clean() {
        doris.update("DELETE FROM ods_ep.ep_mz_cfzb");
        doris.update("DELETE FROM dataos_mpi.mpi_source_identity");
        doris.update("DELETE FROM dataos_mpi.mpi_candidate_pair");
        doris.update("DELETE FROM dataos_mpi.mpi_match_result");
        pg.update("DELETE FROM data_os_mpi.mpi_person_link");
        pg.update("DELETE FROM data_os_mpi.mpi_person");
        pg.update("DELETE FROM data_os_mpi.mpi_review_task");
        pg.update("DELETE FROM data_os_mpi.mpi_audit_event");
        pg.update("DELETE FROM data_os_mpi.mpi_rule_version");
    }

    private void seed() {
        // H0001 卡 C1 四身份：张三(1) 王五(3) 李四(2) 张三(7)；
        // 张三(5) 独立卡 zz1、与张三(1) 同联系方式 → B6。
        doris.batchUpdate("""
                INSERT INTO ods_ep.ep_mz_cfzb (YLJGDM, PATIENT_ID, HZXM, HZXB, KH, HZNL, LXFS)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, List.of(
                new Object[] {"H0001", 1L, "张三", "男", "C1", "3", "13800000000"},
                new Object[] {"H0001", 2L, "李四", "女", "C1", "5", null},
                new Object[] {"H0001", 3L, "王五", "男", "C1", "7", null},
                new Object[] {"H0001", 7L, "张三", "男", "C1", "9", null},
                new Object[] {"H0001", 5L, "张三", "男", "zz1", "9", "13800000000"}));
    }

    private MpiDecisionService.DecisionStats runPipeline() {
        loader.load("default", "EP");
        blocking.generate("default");
        return decisions.decideAll("default", "demo-hospital", "tester");
    }

    @Test
    void fullFlowProducesThreeOutcomesPersonsAndTasks() {
        seed();
        var stats = runPipeline();

        // 7 对：B4 同卡 6 对 + B6 同联系 1 对。
        // (EP|1,EP|7) 同卡同名同男 → M-ep2 AUTO；其余 5 对同卡冲突 → P-ep1；
        // (EP|1,EP|5) 同名同男卡互异 → P-ep2。
        assertThat(stats.autoMatch()).isEqualTo(1);
        assertThat(stats.review()).isEqualTo(6);
        assertThat(stats.noMatch()).isZero();
        assertThat(stats.hardConflict()).isZero();

        // 黄金人：张三 person 收编 EP|1 与 EP|7（decision_source=RULE）。
        var personCount = pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_person", Integer.class);
        assertThat(personCount).isEqualTo(1);
        var links = pg.queryForList("""
                SELECT source_identifier, decision_source FROM data_os_mpi.mpi_person_link
                WHERE valid_to IS NULL AND link_status = 'ACTIVE'
                """);
        assertThat(links).hasSize(2);
        assertThat(links).allSatisfy(link ->
                assertThat(link.get("DECISION_SOURCE")).isEqualTo("RULE"));

        // Doris 回写：两个身份的 mpi_person_id 已指向同一黄金人。
        var writtenBack = doris.queryForMap("""
                SELECT COUNT(*) AS linked FROM dataos_mpi.mpi_source_identity
                WHERE mpi_person_id IS NOT NULL
                """);
        assertThat(((Number) writtenBack.get("LINKED")).intValue()).isEqualTo(2);

        // 复核任务：6 个 OPEN（P-ep1×5 + P-ep2×1）。
        var tasks = pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_review_task WHERE status = 'OPEN'",
                Integer.class);
        assertThat(tasks).isEqualTo(6);

        // 匹配结果三态落库 + 证据含掩码卡号。
        var outcomes = doris.queryForList(
                "SELECT outcome, COUNT(*) c FROM dataos_mpi.mpi_match_result GROUP BY outcome");
        assertThat(outcomes).anySatisfy(row -> {
            assertThat(row.get("OUTCOME")).isEqualTo("AUTO_MATCH");
            assertThat(((Number) row.get("C")).intValue()).isEqualTo(1);
        });
        var evidence = doris.queryForObject("""
                SELECT evidence FROM dataos_mpi.mpi_match_result WHERE outcome = 'REVIEW' LIMIT 1
                """, String.class);
        assertThat(evidence).doesNotContain("C1\"");
    }

    @Test
    void rebuildIsIdempotentForPersonsTasksAndResults() {
        seed();
        runPipeline();
        var statsAgain = runPipeline();

        assertThat(statsAgain.autoMatch()).isEqualTo(1);
        assertThat(pg.queryForObject("SELECT COUNT(*) FROM data_os_mpi.mpi_person", Integer.class))
                .isEqualTo(1);
        assertThat(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_review_task", Integer.class)).isEqualTo(6);
        // 幂等路径（已同人）不再追加 AUTO_MATCH 审计。
        assertThat(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_audit_event WHERE action = 'AUTO_MATCH'",
                Integer.class)).isEqualTo(1);
    }

    @Test
    void humanDifferentPersonDecisionBecomesHardConflictOnNextRun() {
        seed();
        runPipeline();
        // 人工判定 (EP|1,EP|2)（张三 vs 李四同卡）为不同人。
        long pairId = doris.queryForObject("""
                SELECT pair_id FROM dataos_mpi.mpi_candidate_pair
                WHERE identity_a = 'H0001|EP|1' AND identity_b = 'H0001|EP|2'
                """, Long.class);
        pg.update("""
                UPDATE data_os_mpi.mpi_review_task
                SET status = 'RESOLVED', resolution = 'DIFFERENT_PERSON',
                    resolved_by = 'reviewer', resolved_at = CURRENT_TIMESTAMP
                WHERE pair_id = ?
                """, pairId);

        var stats = runPipeline();

        // H-ep1：同对再次候选 → HARD_CONFLICT，不再 AUTO/REVIEW、不再重建任务。
        assertThat(stats.hardConflict()).isEqualTo(1);
        assertThat(stats.review()).isEqualTo(5);
        var outcome = doris.queryForMap(
                "SELECT rule_id, outcome FROM dataos_mpi.mpi_match_result WHERE pair_id = ?",
                pairId);
        assertThat(outcome.get("RULE_ID")).isEqualTo("H-ep1");
        assertThat(outcome.get("OUTCOME")).isEqualTo("HARD_CONFLICT");
    }

    @Test
    void splitCreatesIndependentPersonAndBlocksReMerge() {
        seed();
        runPipeline();
        // 张三 person（EP|1+EP|7）：人工拆出 EP|7。
        var personId = pg.queryForObject(
                "SELECT id FROM data_os_mpi.mpi_person", String.class);
        persons.splitIdentity("default", "demo-hospital", personId, "H0001|EP|7", "reviewer", "挂号重复");

        // 拆分后：原 person 只剩 EP|1，EP|7 获得独立 person。
        var activePersons = pg.queryForObject("""
                SELECT COUNT(DISTINCT person_id) FROM data_os_mpi.mpi_person_link
                WHERE valid_to IS NULL AND link_status = 'ACTIVE'
                """, Integer.class);
        assertThat(activePersons).isEqualTo(2);
        var splitAudit = pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_audit_event WHERE action = 'SPLIT'",
                Integer.class);
        assertThat(splitAudit).isEqualTo(1);

        // 重算：(EP|1,EP|7) 再次同卡同名候选，但 H-ep2 否决 → 不再 AUTO。
        var stats = runPipeline();
        assertThat(stats.hardConflict()).isEqualTo(1);
        assertThat(stats.autoMatch()).isZero();
        var ruleId = doris.queryForObject("""
                SELECT rule_id FROM dataos_mpi.mpi_match_result mr
                JOIN dataos_mpi.mpi_candidate_pair cp ON cp.pair_id = mr.pair_id
                WHERE cp.identity_a = 'H0001|EP|1' AND cp.identity_b = 'H0001|EP|7'
                """, String.class);
        assertThat(ruleId).isEqualTo("H-ep2");
    }
}
