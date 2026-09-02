package com.cywu.dataos.mpi.review;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import com.cywu.dataos.mpi.candidate.MpiBlockingService;
import com.cywu.dataos.mpi.decision.MpiDecisionService;
import com.cywu.dataos.mpi.load.MpiLoaderService;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 复核工作台 API 契约（验收 #5/#7/#8 的 API 层）：
 * 候选列表（掩码）→ explain → 同人决策（并人 MANUAL）→ 不同人决策
 * （终态 + H-ep1 下轮拦截）→ 黄金人详情 → metrics 与库内一致。
 */
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Sql("/mpi-doris-test-schema.sql")
class MpiReviewApiTests {

    @Autowired
    @Qualifier("dorisJdbc")
    private JdbcTemplate doris;

    @Autowired
    private JdbcTemplate pg;

    @Autowired
    private TestRestTemplate rest;

    @Autowired
    private MpiLoaderService loader;

    @Autowired
    private MpiBlockingService blocking;

    @Autowired
    private MpiDecisionService decisions;

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

    /** 全链重算并返回决策统计。 */
    private MpiDecisionService.DecisionStats rebuild() {
        loader.load("default", "EP");
        blocking.generate("default");
        return decisions.decideAll("default", "demo-hospital", "tester");
    }

    private void seed() {
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

    private String taskIdOfPair(String identityA, String identityB) {
        var pairId = doris.queryForObject("""
                SELECT pair_id FROM dataos_mpi.mpi_candidate_pair
                WHERE identity_a = ? AND identity_b = ?
                """, Long.class, identityA, identityB);
        return pg.queryForObject("SELECT id FROM data_os_mpi.mpi_review_task WHERE pair_id = ?",
                String.class, pairId);
    }

    @Test
    @SuppressWarnings("unchecked")
    void candidatesListMasksCardAndReturnsEvidence() {
        seed();
        rebuild();
        var entity = rest.getForEntity("/api/v1/mpi/candidates?status=OPEN", Map.class);
        assertThat(entity.getStatusCode().value()).isEqualTo(200);
        var body = entity.getBody();
        // 否决带免除 5 个 P-ep1 任务，只剩 (1,5) P-ep2 存活对。
        assertThat(((Number) body.get("total")).intValue()).isEqualTo(1);
        var items = (List<Map<String, Object>>) body.get("items");
        assertThat(items).hasSize(1);
        var first = items.get(0);
        var identityA = (Map<String, Object>) first.get("identityA");
        // 展示纪律：姓名明文、卡号掩码（短卡号全掩）、无联系方式字段。
        assertThat(identityA.get("name")).isEqualTo("张三");
        assertThat((String) identityA.get("cardNo")).isEqualTo("***");
        assertThat(identityA).doesNotContainKey("contact");
        assertThat((String) first.get("evidence")).contains("cardNo");
    }

    @Test
    @SuppressWarnings("unchecked")
    void explainReturnsRuleAndFieldEvidence() {
        seed();
        rebuild();
        var pairId = doris.queryForObject("""
                SELECT pair_id FROM dataos_mpi.mpi_candidate_pair
                WHERE identity_a = 'H0001|EP|1' AND identity_b = 'H0001|EP|7'
                """, Long.class);
        var entity = rest.getForEntity("/api/v1/mpi/matches/" + pairId + "/explain", Map.class);
        assertThat(entity.getStatusCode().value()).isEqualTo(200);
        var body = entity.getBody();
        assertThat(body.get("ruleId")).isEqualTo("M-ep2");
        assertThat(body.get("outcome")).isEqualTo("AUTO_MATCH");
        assertThat(body.get("ruleVersion")).isEqualTo("v1+v2");
        assertThat((String) body.get("evidence")).contains("\"field\":\"cardNo\"");
    }

    @Test
    @SuppressWarnings("unchecked")
    void samePersonDecisionCreatesManualPersonAndSurvivesRebuild() {
        seed();
        rebuild();
        // (H0001|EP|1, H0001|EP|5)：同名同性别卡互异（P-ep2）→ 人工确认同人。
        var taskId = taskIdOfPair("H0001|EP|1", "H0001|EP|5");
        var response = post("/api/v1/mpi/links/" + taskId + "/decision",
                Map.of("resolution", "SAME_PERSON", "reason", "联系方式一致，确认为同一人"));
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(String.valueOf(((Map<?, ?>) response.getBody()).get("mergedPersonId"))).isNotEmpty();

        // 决策源 MANUAL（两个身份的当前链接）、任务终态、审计落 DECISION。
        var decisionSources = pg.queryForList("""
                SELECT decision_source FROM data_os_mpi.mpi_person_link
                WHERE source_identifier IN ('H0001|EP|1', 'H0001|EP|5') AND valid_to IS NULL
                """, String.class);
        assertThat(decisionSources).containsExactly("MANUAL", "MANUAL");
        assertThat(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_review_task WHERE status = 'RESOLVED'",
                Integer.class)).isEqualTo(1);
        assertThat(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_audit_event WHERE action = 'DECISION'",
                Integer.class)).isEqualTo(1);

        // 重算不重建已决任务、人工归属不被规则改写（否决带免除其余任务）。
        rebuild();
        assertThat(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_review_task", Integer.class)).isEqualTo(1);

        // 重复决策 → 409。
        var conflict = post("/api/v1/mpi/links/" + taskId + "/decision",
                Map.of("resolution", "SAME_PERSON"));
        assertThat(conflict.getStatusCode().value()).isEqualTo(409);
    }

    @Test
    @SuppressWarnings("unchecked")
    void differentPersonDecisionIsTerminalAndBlocksFutureAuto() {
        seed();
        rebuild();
        var taskId = taskIdOfPair("H0001|EP|1", "H0001|EP|5");
        var response = post("/api/v1/mpi/links/" + taskId + "/decision",
                Map.of("resolution", "DIFFERENT_PERSON", "reason", "登记重复，非同一人"));
        assertThat(response.getStatusCode().value()).isEqualTo(200);

        var stats = rebuild();
        assertThat(stats.hardConflict()).isEqualTo(1);
        var reviewAfter = pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_review_task WHERE status = 'OPEN'",
                Integer.class);
        // 该对终态后复核队列清空（其余 P-ep1 对已被否决带免除）。
        assertThat(reviewAfter).isZero();
    }

    @Test
    @SuppressWarnings("unchecked")
    void personDetailExposesLinksAndHistory() {
        seed();
        rebuild();
        var personId = pg.queryForObject("SELECT id FROM data_os_mpi.mpi_person", String.class);
        var entity = rest.getForEntity("/api/v1/mpi/persons/" + personId, Map.class);
        assertThat(entity.getStatusCode().value()).isEqualTo(200);
        var body = entity.getBody();
        assertThat(body.get("goldenName")).isEqualTo("张三");
        var links = (List<?>) body.get("links");
        assertThat(links).isNotEmpty();
        var history = (List<?>) body.get("history");
        assertThat(history).isNotEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void metricsMatchStoredState() {
        seed();
        rebuild();
        var entity = rest.getForEntity("/api/v1/mpi/metrics", Map.class);
        var body = entity.getBody();
        assertThat(((Number) body.get("identitiesLoaded")).longValue()).isEqualTo(5);
        assertThat(((Number) body.get("goldenPersons")).longValue()).isEqualTo(1);
        assertThat(((Number) body.get("autoMatches")).longValue()).isEqualTo(1);
        assertThat(((Number) body.get("reviewPending")).longValue()).isEqualTo(1);
        assertThat(((Number) body.get("reviewResolved")).longValue()).isEqualTo(0);
    }

    private <T> org.springframework.http.ResponseEntity<Map> post(String uri, Map<String, String> payload) {
        var headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        return rest.exchange(uri, HttpMethod.POST, new HttpEntity<>(payload, headers), Map.class);
    }
}
