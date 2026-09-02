package com.cywu.dataos.mpi.person;

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
import com.cywu.dataos.mpi.decision.MpiDecisionService;
import com.cywu.dataos.mpi.load.MpiLoaderService;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 归并格子（单一属主 MpiPersonService.unite）的不变量：
 * 并人统一保留创建较早者（earlierOf，与入口/发起方向无关）、链接与
 * Doris 投影回写只走格子、幂等早退补投影但不产生新链接/审计。
 */
@ActiveProfiles("test")
@SpringBootTest
@Sql("/mpi-doris-test-schema.sql")
class MpiPersonUniteTests {

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
        // 卡 C1：张三(1)+张三(7) → M-ep2 自动成 personA；
        // 卡 C2：李四(2)+李四(8) → M-ep2 自动成 personB；
        // 孤立身份 赵六(9)/钱七(10) 各自无候选、无黄金人。
        doris.batchUpdate("""
                INSERT INTO ods_ep.ep_mz_cfzb (YLJGDM, PATIENT_ID, HZXM, HZXB, KH, HZNL, LXFS)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, List.of(
                new Object[] {"H0001", 1L, "张三", "男", "C1", "3", null},
                new Object[] {"H0001", 7L, "张三", "男", "C1", "9", null},
                new Object[] {"H0001", 2L, "李四", "女", "C2", "5", null},
                new Object[] {"H0001", 8L, "李四", "女", "C2", "5", null},
                new Object[] {"H0001", 9L, "赵六", "男", "C9", "3", null},
                new Object[] {"H0001", 10L, "钱七", "女", "C10", "3", null}));
        loader.load("default", "EP");
        blocking.generate("default");
        decisions.decideAll("default", "demo-hospital", "tester");
    }

    private String personIdOf(String identityGroup) {
        return doris.queryForObject("""
                SELECT mpi_person_id FROM dataos_mpi.mpi_source_identity
                WHERE CONCAT(institution_code, '|', source_system, '|', source_key) = ?
                """, String.class, identityGroup);
    }

    @Test
    void manualMergeKeepsEarlierPersonAndWritesBackProjection() {
        seed();
        var personA = personIdOf("H0001|EP|1");
        var personB = personIdOf("H0001|EP|2");
        // 统一不变量：存活者 = 创建较早者（created_at 决胜，id 兜底防平局）。
        var expected = pg.queryForObject("""
                SELECT id FROM data_os_mpi.mpi_person
                WHERE id IN (?, ?) AND status = 'ACTIVE'
                ORDER BY created_at ASC, id ASC LIMIT 1
                """, String.class, personA, personB);
        var dropped = expected.equals(personA) ? personB : personA;

        var survivor = persons.uniteManual("default", "demo-hospital",
                "H0001|EP|1", "H0001|EP|2", "reviewer");

        assertThat(survivor).isEqualTo(expected);
        assertThat(pg.queryForObject("""
                SELECT status FROM data_os_mpi.mpi_person WHERE id = ?
                """, String.class, dropped)).isEqualTo("MERGED");
        // 被并人的全部身份改挂存活者（EP|8 随 personB 迁移）。
        assertThat(pg.queryForList("""
                SELECT DISTINCT person_id FROM data_os_mpi.mpi_person_link
                WHERE valid_to IS NULL AND link_status = 'ACTIVE'
                """, String.class)).containsExactly(expected);
        // Doris 投影回写经格子单点发生：对内两个身份 + 迁移身份全部指向存活者。
        assertThat(personIdOf("H0001|EP|1")).isEqualTo(expected);
        assertThat(personIdOf("H0001|EP|2")).isEqualTo(expected);
        assertThat(personIdOf("H0001|EP|8")).isEqualTo(expected);
        assertThat(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_audit_event WHERE action = 'MERGE'",
                Integer.class)).isEqualTo(1);
    }

    @Test
    void manualCreateUsesIdentityANameAndWritesBackProjection() {
        seed();
        var survivor = persons.uniteManual("default", "demo-hospital",
                "H0001|EP|9", "H0001|EP|10", "reviewer");

        // 双方均无黄金人：以 identityA 的登记名建人，两个身份的投影同步回写。
        assertThat(pg.queryForObject("""
                SELECT golden_name FROM data_os_mpi.mpi_person WHERE id = ?
                """, String.class, survivor)).isEqualTo("赵六");
        assertThat(pg.queryForList("""
                SELECT decision_source FROM data_os_mpi.mpi_person_link
                WHERE source_identifier IN ('H0001|EP|9', 'H0001|EP|10') AND valid_to IS NULL
                """, String.class)).containsExactly("MANUAL", "MANUAL");
        assertThat(personIdOf("H0001|EP|9")).isEqualTo(survivor);
        assertThat(personIdOf("H0001|EP|10")).isEqualTo(survivor);
    }

    @Test
    void manualUniteIsIdempotentForAlreadyUnitedPair() {
        seed();
        var personA = personIdOf("H0001|EP|1");
        var linksBefore = pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_person_link WHERE valid_to IS NULL",
                Integer.class);
        // 模拟装载重装对回写列的重置。
        doris.update("UPDATE dataos_mpi.mpi_source_identity SET mpi_person_id = NULL");

        var survivor = persons.uniteManual("default", "demo-hospital",
                "H0001|EP|1", "H0001|EP|7", "reviewer");

        // 已同人：幂等早退——补投影回写，但不新增链接、不产生 MERGE 审计。
        assertThat(survivor).isEqualTo(personA);
        assertThat(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_person_link WHERE valid_to IS NULL",
                Integer.class)).isEqualTo(linksBefore);
        assertThat(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_audit_event WHERE action = 'MERGE'",
                Integer.class)).isZero();
        assertThat(personIdOf("H0001|EP|1")).isEqualTo(personA);
        assertThat(personIdOf("H0001|EP|7")).isEqualTo(personA);
    }
}
