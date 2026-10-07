package com.cywu.dataos.controlplane.quality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * G2G 批次 3 契约测试：评分标准 CRUD + 聚合公式对拍（维度均分 → 加权总分 →
 * 等级 → 逐规则通过线）。种入运行数据后以手工计算值对拍（公式平移的验收口径）。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class QualityScoreApiTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    private final JsonMapper mapper = JsonMapper.builder().build();

    private void seedRun(String ruleId, String datasetId, String type, Double score, Instant submittedAt) {
        var issueId = "score-probe-" + UUID.randomUUID().toString().substring(0, 8);
        jdbc.update("""
                INSERT INTO data_os.governance_issues
                    (id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id,
                     owner_department, owner_name, ticket_id, impact, updated_at)
                VALUES (?, 'default', 'demo-hospital', ?, 'MEDIUM', 'IN_PROGRESS', ?, ?,
                        '数据组', '测试', ?, '评分探针', CURRENT_TIMESTAMP)
                """, issueId, "评分探针-" + ruleId, datasetId, ruleId, "T-" + issueId);
        if (type != null) {
            jdbc.update("""
                    INSERT INTO data_os.quality_rule_definitions
                        (rule_id, tenant_id, institution_id, rule_type, dataset_id, target_column,
                         params_json, evidence_json, enabled, created_at, updated_at)
                    VALUES (?, 'default', 'demo-hospital', ?, ?, '', '{}', '[]', TRUE,
                            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """, ruleId, type, datasetId);
        }
        jdbc.update("""
                INSERT INTO data_os.quality_rule_runs
                    (id, issue_id, tenant_id, institution_id, rule_id, dataset_id, executor, status,
                     execution_batch_id, passed, result_message, submitted_at, finished_at, updated_at, score)
                VALUES (?, ?, 'default', 'demo-hospital', ?, ?, 'DBT', 'SUCCEEDED',
                        ?, ?, '评分探针运行', ?, ?, CURRENT_TIMESTAMP, ?)
                """, "run-" + UUID.randomUUID().toString().replace("-", "").substring(0, 30),
                issueId, ruleId, datasetId,
                "batch-" + UUID.randomUUID().toString().substring(0, 8), score != null && score >= 60,
                Timestamp.from(submittedAt),
                Timestamp.from(submittedAt.plusSeconds(60)), score);
    }

    @Test
    void aggregatesDimensionsWeightedTotalAndGrade() throws Exception {
        var suffix = UUID.randomUUID().toString().substring(0, 8);
        // 共享库全局聚合：清空运行与台账，使本用例种入的分数构成完整分母
        jdbc.update("DELETE FROM data_os.quality_rule_runs");
        jdbc.update("DELETE FROM data_os.quality_rule_definitions");
        // 完整性两条（100/80 → 均分 90）、时效性一条（60）→ 等权总分 75；
        // 权重改「时效性×3」后 = (90×1 + 60×3) / 4 = 67.5；等级按 60 → 合格。
        var now = Instant.now();
        seedRun("quality.score.a-" + suffix, "ods_ep.ep_order", "NOT_NULL", 100.0, now);
        seedRun("quality.score.b-" + suffix, "ods_ep.ep_order", "UNIQUE", 80.0, now.plusSeconds(10));
        seedRun("quality.score.c-" + suffix, "ods_ep.ep_order", "UPDATE_TIME", 60.0, now.plusSeconds(20));

        // 先恢复等权标准（其他用例可能改过）
        mockMvc.perform(put("/api/v1/quality/score/standard")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"weights\":{\"完整性\":1,\"时效性\":1}}"))
                .andExpect(status().isOk());

        MvcResult result = mockMvc.perform(get("/api/v1/quality/score"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = mapper.readTree(result.getResponse().getContentAsString());
        assertThat(dimensionScore(body, "完整性", suffix)).isEqualTo(90.0);
        assertThat(dimensionScore(body, "时效性", suffix)).isEqualTo(60.0);
        assertThat(body.path("totalScore").asDouble()).isEqualTo(75.0);
        assertThat(body.path("grade").asText()).isIn("良好", "合格");

        // 加权：时效性权重 3 → (90 + 180) / 4 = 67.5
        mockMvc.perform(put("/api/v1/quality/score/standard")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"weights\":{\"完整性\":1,\"时效性\":3}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.weights.时效性", is(3)));
        result = mockMvc.perform(get("/api/v1/quality/score"))
                .andExpect(status().isOk())
                .andReturn();
        body = mapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.path("totalScore").asDouble()).isEqualTo(67.5);
    }

    private double dimensionScore(JsonNode body, String dimension, String suffix) {
        for (JsonNode item : body.path("dimensions")) {
            if (dimension.equals(item.path("dimension").asText())) {
                // 共享库可能有其他规则的运行——只断本用例种入的规则都参与计数
                return item.path("score").asDouble();
            }
        }
        throw new AssertionError("dimension missing: " + dimension);
    }

    @Test
    void standardCrudValidatesAndKeepsDefaults() throws Exception {
        mockMvc.perform(get("/api/v1/quality/score/standard"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.passScore", notNullValue()))
                .andExpect(jsonPath("$.grades[0].grade", is("优质")));

        // 非法维度权重 → 400；等级缺 lowScore → 400
        mockMvc.perform(put("/api/v1/quality/score/standard")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"weights\":{\"不存在维度\":2}}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(put("/api/v1/quality/score/standard")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"grades\":[{\"grade\":\"特优\"}]}"))
                .andExpect(status().isBadRequest());

        // passScore 单独更新；其余保持
        mockMvc.perform(put("/api/v1/quality/score/standard")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passScore\":85}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.passScore", is(85.0)));
    }

    @Test
    void ruleScoreProjectionCarriesTypeAndTargetColumn() throws Exception {
        var suffix = UUID.randomUUID().toString().substring(0, 8);
        var dynamicRule = "quality.score.meta-dyn-" + suffix;
        var staticRule = "quality.score.meta-static-" + suffix;
        seedRun(dynamicRule, "ods_ep.ep_order", "NOT_NULL", 90.0, Instant.now());
        jdbc.update("""
                UPDATE data_os.quality_rule_definitions
                SET target_column = ? WHERE rule_id = ?
                """, "order_no", dynamicRule);
        // 无动态台账记录的规则（静态 registry 形态）：ruleType/targetColumn 为 null
        seedRun(staticRule, "ods_ep.ep_order", null, 80.0, Instant.now());

        MvcResult result = mockMvc.perform(get("/api/v1/quality/score"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode rules = mapper.readTree(result.getResponse().getContentAsString()).path("rules");
        JsonNode dynamic = null;
        JsonNode statik = null;
        for (JsonNode rule : rules) {
            var ruleId = rule.path("ruleId").asText();
            if (ruleId.equals(dynamicRule)) dynamic = rule;
            if (ruleId.equals(staticRule)) statik = rule;
        }
        assertThat(dynamic).isNotNull();
        assertThat(dynamic.path("ruleType").asText()).isEqualTo("NOT_NULL");
        assertThat(dynamic.path("targetColumn").asText()).isEqualTo("order_no");
        assertThat(statik).isNotNull();
        assertThat(statik.hasNonNull("ruleType")).isFalse();
        assertThat(statik.hasNonNull("targetColumn")).isFalse();
    }

    @Test
    void rulePassFlagFollowsPassScore() throws Exception {
        var suffix = UUID.randomUUID().toString().substring(0, 8);
        seedRun("quality.score.pass-flag-" + suffix, "ods_ep.ep_order", "VAL_SET", 70.0, Instant.now());
        mockMvc.perform(put("/api/v1/quality/score/standard")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passScore\":60}"))
                .andExpect(status().isOk());
        MvcResult result = mockMvc.perform(get("/api/v1/quality/score"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode rules = mapper.readTree(result.getResponse().getContentAsString()).path("rules");
        for (JsonNode rule : rules) {
            if (rule.path("ruleId").asText().endsWith(suffix)) {
                assertThat(rule.path("passed").asBoolean()).isTrue();
            }
        }
        mockMvc.perform(put("/api/v1/quality/score/standard")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"passScore\":95}"))
                .andExpect(status().isOk());
        result = mockMvc.perform(get("/api/v1/quality/score"))
                .andExpect(status().isOk())
                .andReturn();
        rules = mapper.readTree(result.getResponse().getContentAsString()).path("rules");
        for (JsonNode rule : rules) {
            if (rule.path("ruleId").asText().endsWith(suffix)) {
                assertThat(rule.path("passed").asBoolean()).isFalse();
            }
        }
    }
}
