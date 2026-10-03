package com.cywu.dataos.controlplane.source;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
 * G2G 批次 1 第一刀契约测试：连接登记 + 目录三段懒加载 + 受控查询。
 * 目标源即测试进程的共享 H2 内存库（jdbc:h2:mem:dataos;MODE=PostgreSQL），
 * catalogs/tables/columns/query 全部走真实 DatabaseMetaData 与执行计划。
 * 共享库上不做全局精确计数断言（顺序鲁棒），用「包含自建唯一键」方式验证。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SourceExplorerApiTest {

    private static final String H2_URL = "jdbc:h2:mem:dataos;MODE=PostgreSQL";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    private String registerSource(String protocol) throws Exception {
        var name = "浏览测试源-" + UUID.randomUUID();
        MvcResult result = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "name":"%s",
                                  "systemType":"LIS",
                                  "protocol":"%s"
                                }
                                """.formatted(name, protocol)))
                .andExpect(status().isCreated())
                .andReturn();
        return JsonMapper.builder().build().readTree(result.getResponse().getContentAsString()).path("id").asText();
    }

    private void saveConnection(String sourceId, String body) throws Exception {
        mockMvc.perform(put("/api/v1/sources/" + sourceId + "/connection")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk());
    }

    private String connectedSource() throws Exception {
        var sourceId = registerSource("JDBC");
        saveConnection(sourceId, """
                {"config":{"jdbcUrl":"%s","username":"sa"}}
                """.formatted(H2_URL));
        return sourceId;
    }

    private String currentCatalog(String sourceId) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/sources/" + sourceId + "/catalogs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.truncated", is(false)))
                .andReturn();
        JsonNode catalogs = JsonMapper.builder().build()
                .readTree(result.getResponse().getContentAsString()).path("catalogs");
        assertThat(catalogs.size()).isGreaterThan(0);
        for (JsonNode catalog : catalogs) {
            if (catalog.asText().equalsIgnoreCase("dataos")) return catalog.asText();
        }
        return catalogs.get(0).asText();
    }

    @Test
    void savesNonSensitiveConnectionAndStripsNothingSensitive() throws Exception {
        var sourceId = registerSource("JDBC");
        MvcResult result = mockMvc.perform(put("/api/v1/sources/" + sourceId + "/connection")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"config":{"jdbcUrl":"%s","username":"sa","credentialRef":""}}
                                """.formatted(H2_URL)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.connection.jdbcUrl", is(H2_URL)))
                .andExpect(jsonPath("$.connection.username", is("sa")))
                .andReturn();
        // 落库内容不含任何敏感键（credentialRef 空串也不保留）。
        var stored = jdbc.queryForObject(
                "SELECT connection_json FROM data_os.sources WHERE id = ?", String.class, sourceId);
        assertThat(stored).doesNotContain("password", "secret", "token", "credentialRef");
    }

    @Test
    void rejectsPlainTextCredentialsAndBlockedHostsOnConnectionSave() throws Exception {
        var sourceId = registerSource("JDBC");
        mockMvc.perform(put("/api/v1/sources/" + sourceId + "/connection")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"config":{"jdbcUrl":"%s","password":"plain-secret"}}
                                """.formatted(H2_URL)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_REQUEST")))
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("明文凭据")));

        mockMvc.perform(put("/api/v1/sources/" + sourceId + "/connection")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"config":{"jdbcUrl":"jdbc:mysql://169.254.169.254/his"}}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("禁止访问")));

        mockMvc.perform(put("/api/v1/sources/" + sourceId + "/connection")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("jdbcUrl")));
    }

    @Test
    void browsesCatalogsTablesAndColumnsLazily() throws Exception {
        var sourceId = connectedSource();
        var catalog = currentCatalog(sourceId);

        // H2 PG 模式沿用 PostgreSQL 口径：普通表类型为 BASE TABLE。
        mockMvc.perform(get("/api/v1/sources/" + sourceId + "/tables").param("catalog", catalog))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.truncated", is(false)))
                .andExpect(jsonPath("$.tables[?(@.name == 'SOURCES')].type", hasItem("BASE TABLE")))
                .andExpect(jsonPath("$.tables[?(@.name == 'VIEWS')].type", hasItem("VIEW")));

        MvcResult columnResult = mockMvc.perform(get("/api/v1/sources/" + sourceId + "/columns")
                        .param("catalog", catalog)
                        .param("table", "SOURCES"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode columns = JsonMapper.builder().build()
                .readTree(columnResult.getResponse().getContentAsString()).path("columns");
        var names = new StringBuilder();
        columns.forEach(column -> names.append(column.path("name").asText()).append(','));
        assertThat(names.toString()).contains("PROTOCOL").contains("CONNECTION_JSON");

        mockMvc.perform(get("/api/v1/sources/" + sourceId + "/columns")
                        .param("catalog", catalog)
                        .param("table", ""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("表名")));
    }

    @Test
    void rejectsNonJdbcProtocolAndMissingConnectionForBrowsing() throws Exception {
        var httpSourceId = registerSource("HTTP");
        mockMvc.perform(get("/api/v1/sources/" + httpSourceId + "/catalogs"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("仅支持 JDBC")));

        var bareSourceId = registerSource("JDBC");
        mockMvc.perform(get("/api/v1/sources/" + bareSourceId + "/catalogs"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("尚未登记连接配置")));

        mockMvc.perform(get("/api/v1/sources/no-such-source/catalogs"))
                .andExpect(status().isNotFound());
    }

    @Test
    void runsReadOnlyQueryWithWrappedLimitAndStringCells() throws Exception {
        var sourceId = connectedSource();
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"sql":"SELECT 41 + 1 AS answer, CAST(NULL AS INT) AS nothing"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.columns[0]", is("ANSWER")))
                .andExpect(jsonPath("$.columns[1]", is("NOTHING")))
                .andExpect(jsonPath("$.rows[0][0]", is("42")))
                .andExpect(jsonPath("$.rows[0][1]", nullValue()))
                .andExpect(jsonPath("$.truncated", is(false)));
    }

    @Test
    void capsRowsAndReportsTruncationWithoutUserLimit() throws Exception {
        var sourceId = connectedSource();
        // 无 LIMIT 语句由服务端包层封顶：请求 3 行，读到第 4 行即 truncated。
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"sql":"SELECT X FROM SYSTEM_RANGE(1, 5)","maxRows":3}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rows", hasSize(3)))
                .andExpect(jsonPath("$.truncated", is(true)));

        // 用户显式 LIMIT 被信任，不重复包层；结果不足上限即未截断。
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"sql":"SELECT X FROM SYSTEM_RANGE(1, 5) LIMIT 2"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rows", hasSize(2)))
                .andExpect(jsonPath("$.truncated", is(false)));

        // 超过服务端硬上限（1000）的请求被钳制，不放大结果面。
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"sql":"SELECT X FROM SYSTEM_RANGE(1, 1500)","maxRows":5000}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rows", hasSize(1000)))
                .andExpect(jsonPath("$.truncated", is(true)));
    }

    @Test
    void rejectsWriteStatementsMultipleStatementsAndCommentEvasion() throws Exception {
        var sourceId = connectedSource();
        var mapper = JsonMapper.builder().build();
        var writeBody = mapper.writeValueAsString(java.util.Map.of("sql", "DELETE FROM data_os.sources"));
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON).content(writeBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("只读查询")));

        var multiBody = mapper.writeValueAsString(java.util.Map.of("sql", "SELECT 1; SELECT 2"));
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON).content(multiBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", org.hamcrest.Matchers.containsString("单条")));

        // 注释剥离后以写语句开头同样拒绝（防「注释包裹 DML」绕过）。
        var commentBody = mapper.writeValueAsString(
                java.util.Map.of("sql", "/* route marker */ UPDATE data_os.sources SET status = 'HEALTHY'"));
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON).content(commentBody))
                .andExpect(status().isBadRequest());

        // 前置行注释不影响合法 SELECT 执行。
        var leadingCommentBody = mapper.writeValueAsString(
                java.util.Map.of("sql", "-- 取主键探针\nSELECT 7 AS probe"));
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON).content(leadingCommentBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rows[0][0]", is("7")));

        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void auditsQueryEndpointThroughTheSharedInterceptor() throws Exception {
        var sourceId = connectedSource();
        mockMvc.perform(post("/api/v1/sources/" + sourceId + "/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sql\":\"SELECT 1 AS audit_probe\"}"))
                .andExpect(status().isOk());
        Integer traced = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.audit_events WHERE path = ?",
                Integer.class, "/api/v1/sources/" + sourceId + "/query");
        assertThat(traced).isGreaterThanOrEqualTo(1);
    }
}
