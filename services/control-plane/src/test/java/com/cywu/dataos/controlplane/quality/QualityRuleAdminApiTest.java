package com.cywu.dataos.controlplane.quality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * G2G 批次 2 首刀契约测试：动态规则台账 CRUD + 推送 runner（本地 stub）。
 * 推送失败（runner 400/5xx）时本地必须回滚——两侧不产生半份状态。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class QualityRuleAdminApiTest {

    private static HttpServer runner;
    private static int port;
    /** stub 收到的请求（method path body），按用例取用。 */
    private static final ConcurrentLinkedQueue<String> pushes = new ConcurrentLinkedQueue<>();
    /** 可配置的拒绝响应；null = 接受。 */
    private static volatile String rejectionBody = null;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    private final JsonMapper mapper = JsonMapper.builder().build();

    @BeforeAll
    static void startStubRunner() throws IOException {
        runner = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        runner.createContext("/api/v1/quality/rules/dynamic", exchange -> {
            var body = new String(exchange.getRequestBody().readAllBytes());
            pushes.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath() + " " + body);
            if (rejectionBody != null) {
                respond(exchange, 400, rejectionBody);
            } else if ("DELETE".equals(exchange.getRequestMethod())) {
                respond(exchange, 200, "{\"ruleId\":\"ok\",\"enabled\":false}");
            } else {
                respond(exchange, 200, "{\"ruleId\":\"ok\",\"selector\":\"dynamic_ok\"}");
            }
        });
        runner.start();
        port = runner.getAddress().getPort();
    }

    @AfterAll
    static void stopStubRunner() {
        runner.stop(0);
    }

    @DynamicPropertySource
    static void runnerBaseUrl(DynamicPropertyRegistry registry) {
        registry.add("data-os.quality.base-url", () -> "http://127.0.0.1:" + port);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        var bytes = body.getBytes();
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    private String saveBody(String type, String column, String params) {
        return """
                {"ruleType":"%s","datasetId":"ods_ep.ep_order","targetColumn":"%s","params":%s,
                 "evidenceColumns":[
                   {"name":"ID","classification":"IDENTIFIER"},
                   {"name":"PAY_STATUS","classification":"CATEGORY"}]}
                """.formatted(type, column, params);
    }

    @Test
    void exposesFullRuleTypeCatalog() throws Exception {
        mockMvc.perform(get("/api/v1/quality/rules/types"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(15)))
                .andExpect(jsonPath("$[0].type", is("NOT_NULL")))
                .andExpect(jsonPath("$[8].type", is("CROSS_VAL_COMPARE")))
                .andExpect(jsonPath("$[14].computedEvidence", is(true)));
    }

    @Test
    void savesSecondCutConsistencyRuleAndPushesToRunner() throws Exception {
        var ruleId = "quality.dynamic.detail-" + UUID.randomUUID().toString().substring(0, 8);
        pushes.clear();
        mockMvc.perform(put("/api/v1/quality/rules/" + ruleId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ruleType":"DETAIL_STAT","datasetId":"ods_ep.ep_order","targetColumn":"AMOUNT",
                                 "params":{"refOp":"SUM","refDataset":"ods_ep.ep_order_item","refColumn":"PAY",
                                           "targetJoinCols":["PATIENT_ID"],"refJoinCols":["PID"]},
                                 "evidenceColumns":[]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ruleType", is("DETAIL_STAT")));
        var last = pushes.stream().reduce((first, second) -> second).orElse(null);
        assertThat(last).isNotNull();
        JsonNode pushed = mapper.readTree(last.substring(last.indexOf('{')));
        assertThat(pushed.path("params").path("refOp").asText()).isEqualTo("SUM");
        assertThat(pushed.path("evidenceColumns").size()).isZero();
    }

    @Test
    void valSetResolvesStandardValueSnapshotAtSave() throws Exception {
        // 种入一个标准（集合 + 数据元 + 值域一次性内联）供字典引用解析
        var suffix = UUID.randomUUID().toString().substring(0, 8);
        var standard = mockMvc.perform(post("/api/v1/data-standards")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"code":"STD-QR-%s","name":"质量规则测试标准%s","description":"","owner":"测试",
                                 "elements":[{"code":"gender-%s","name":"性别代码","dataType":"CODE","required":false,
                                   "values":[{"code":"1","displayName":"男"},{"code":"2","displayName":"女"}]}]}
                                """.formatted(suffix, suffix, suffix)))
                .andReturn().getResponse();
        assertThat(standard.getStatus()).isIn(200, 201);
        var elementId = jdbc.queryForObject(
                "SELECT id FROM data_os.data_standard_element WHERE code = ?", String.class, "gender-" + suffix);

        var ruleId = "quality.dynamic.gender-values-" + suffix;
        pushes.clear();
        mockMvc.perform(put("/api/v1/quality/rules/" + ruleId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ruleType":"VAL_SET","datasetId":"ods_ep.patient","targetColumn":"GENDER",
                                 "params":{"standardElementId":"%s"},"evidenceColumns":[
                                   {"name":"ID","classification":"IDENTIFIER"}]}
                                """.formatted(elementId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.params.values[0]", is("1")))
                .andExpect(jsonPath("$.params.values[1]", is("2")))
                .andExpect(jsonPath("$.params.standardElementId", is(elementId)));
        var last = pushes.stream().reduce((first, second) -> second).orElse(null);
        JsonNode pushed = mapper.readTree(last.substring(last.indexOf('{')));
        assertThat(pushed.path("params").path("values").size()).isEqualTo(2);

        // 引用不存在的数据元 → 拒绝且不落账
        mockMvc.perform(put("/api/v1/quality/rules/quality.dynamic.broken-dict-" + suffix)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"ruleType":"VAL_SET","datasetId":"ods_ep.patient","targetColumn":"GENDER",
                                 "params":{"standardElementId":"no-such-element"},"evidenceColumns":[
                                   {"name":"ID","classification":"IDENTIFIER"}]}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("未找到可用代码")));
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.quality_rule_definitions WHERE rule_id = ?",
                Integer.class, "quality.dynamic.broken-dict-" + suffix);
        assertThat(count).isZero();
    }

    @Test
    void savesRuleLocallyAndPushesFullDefinitionToRunner() throws Exception {
        var ruleId = "quality.dynamic.rule-" + UUID.randomUUID().toString().substring(0, 8);
        pushes.clear();
        mockMvc.perform(put("/api/v1/quality/rules/" + ruleId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody("NOT_NULL", "PAY_STATUS", "{}")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ruleId", is(ruleId)))
                .andExpect(jsonPath("$.ruleType", is("NOT_NULL")))
                .andExpect(jsonPath("$.enabled", is(true)));

        var last = pushes.stream().reduce((first, second) -> second).orElse(null);
        assertThat(last).isNotNull();
        JsonNode pushed = mapper.readTree(last.substring(last.indexOf('{')));
        assertThat(pushed.path("ruleId").asText()).isEqualTo(ruleId);
        assertThat(pushed.path("datasetId").asText()).isEqualTo("ods_ep.ep_order");
        assertThat(pushed.path("evidenceColumns").size()).isEqualTo(2);

        // 共享库可能有其他用例的规则——只断本用例的增量可检索
        MvcResult listed = mockMvc.perform(get("/api/v1/quality/rules"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode items = mapper.readTree(listed.getResponse().getContentAsString()).path("items");
        boolean found = false;
        for (JsonNode item : items) {
            found = found || ruleId.equals(item.path("ruleId").asText());
        }
        assertThat(found).isTrue();
    }

    @Test
    void runnerRejectionRollsBackLocalLedger() throws Exception {
        var ruleId = "quality.dynamic.reject-" + UUID.randomUUID().toString().substring(0, 8);
        rejectionBody = "{\"detail\":\"仅支持只读查询（SELECT / WITH 开头）\"}";
        try {
            mockMvc.perform(put("/api/v1/quality/rules/" + ruleId)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(saveBody("SQL", "", "{\"sql\":\"DROP TABLE x\"}")))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.message",
                            org.hamcrest.Matchers.containsString("只读查询")));
            Integer count = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM data_os.quality_rule_definitions WHERE rule_id = ?",
                    Integer.class, ruleId);
            assertThat(count).isZero();
        } finally {
            rejectionBody = null;
        }
    }

    @Test
    void unsupportedTypeRejectedBeforePush() throws Exception {
        mockMvc.perform(put("/api/v1/quality/rules/quality.dynamic.unknown-type")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody("NEVER_A_TYPE", "UPDATE_TIME", "{\"threshold\":1}")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("不支持的规则类型")));
    }

    @Test
    void disableAndEnableRoundTripThroughRunner() throws Exception {
        var ruleId = "quality.dynamic.toggle-" + UUID.randomUUID().toString().substring(0, 8);
        mockMvc.perform(put("/api/v1/quality/rules/" + ruleId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody("VAL_SET", "PAY_STATUS",
                                "{\"values\":[0,1,\"PAID\"]}")))
                .andExpect(status().isOk());
        pushes.clear();

        mockMvc.perform(post("/api/v1/quality/rules/" + ruleId + "/disable"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled", is(false)));
        assertThat(pushes.poll()).startsWith("DELETE /api/v1/quality/rules/dynamic/" + ruleId);

        mockMvc.perform(post("/api/v1/quality/rules/" + ruleId + "/enable"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enabled", is(true)));
        assertThat(pushes.poll()).startsWith("PUT /api/v1/quality/rules/dynamic/" + ruleId);

        mockMvc.perform(delete("/api/v1/quality/rules/" + ruleId))
                .andExpect(status().isNoContent());
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.quality_rule_definitions WHERE rule_id = ?",
                Integer.class, ruleId);
        assertThat(count).isZero();
        mockMvc.perform(post("/api/v1/quality/rules/" + ruleId + "/disable"))
                .andExpect(status().isNotFound());
    }

    @Test
    void listIncludesEvidenceContractAndParams() throws Exception {
        var ruleId = "quality.dynamic.list-" + UUID.randomUUID().toString().substring(0, 8);
        mockMvc.perform(put("/api/v1/quality/rules/" + ruleId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(saveBody("VAL_MINMAX", "PAY_STATUS", "{\"minVal\":0,\"maxVal\":9}")))
                .andExpect(status().isOk());
        MvcResult result = mockMvc.perform(get("/api/v1/quality/rules"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode items = mapper.readTree(result.getResponse().getContentAsString()).path("items");
        JsonNode mine = null;
        for (JsonNode item : items) {
            if (ruleId.equals(item.path("ruleId").asText())) mine = item;
        }
        assertThat(mine).isNotNull();
        assertThat(mine.path("params").path("minVal").asInt()).isZero();
        assertThat(mine.path("evidenceColumns").size()).isEqualTo(2);
    }
}
