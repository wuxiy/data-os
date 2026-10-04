package com.cywu.dataos.controlplane.job;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
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
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * G2G 批次 1 第二刀契约测试：结构化任务意图（表/SQL 双形态）→ 服务端编译 →
 * 复制与水位暴露。目标源仍是测试进程共享 H2（真实 DatabaseMetaData 校验）；
 * 源连接经凭据服务真实落库（credentialRef 按 id 解析）。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class StructuredTaskApiTest {

    private static final String H2_URL = "jdbc:h2:mem:dataos;MODE=PostgreSQL";

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper mapper = JsonMapper.builder().build();

    private String createCredential() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/credentials")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"结构化任务测试凭据-%s","provider":"STATIC",
                                 "secret":{"username":"sa"}}
                                """.formatted(UUID.randomUUID())))
                .andExpect(status().isCreated())
                .andReturn();
        return mapper.readTree(result.getResponse().getContentAsString()).path("id").asText();
    }

    /** 已登记连接（含 credentialRef）的 JDBC 源。 */
    private String connectedSource() throws Exception {
        var credentialId = createCredential();
        MvcResult result = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"结构化任务源-%s","systemType":"LIS","protocol":"JDBC"}
                                """.formatted(UUID.randomUUID())))
                .andExpect(status().isCreated())
                .andReturn();
        var sourceId = mapper.readTree(result.getResponse().getContentAsString()).path("id").asText();
        mockMvc.perform(put("/api/v1/sources/" + sourceId + "/connection")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"config":{"jdbcUrl":"%s","credentialRef":"%s"}}
                                """.formatted(H2_URL, credentialId)))
                .andExpect(status().isOk());
        return sourceId;
    }

    private String createJob(String sourceId) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"sourceId":"%s","name":"结构化任务-%s","mode":"BATCH","executor":"SEATUNNEL"}
                                """.formatted(sourceId, UUID.randomUUID())))
                .andExpect(status().isCreated())
                .andReturn();
        return mapper.readTree(result.getResponse().getContentAsString()).path("id").asText();
    }

    private MvcResult saveStructured(String jobId, String body) throws Exception {
        return mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
    }

    @Test
    void compilesTableFullTaskWithWhitelistAndConnectionInjection() throws Exception {
        var sourceId = connectedSource();
        var jobId = createJob(sourceId);
        var response = saveStructured(jobId, """
                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                 "structured":{"form":"TABLE","sourceId":"%s","catalog":"DATAOS","tables":["SOURCES"],
                               "columns":["ID","NAME"],"mode":"FULL",
                               "sinkFenodes":"doris-fe:8030","sinkCredentialRef":"doris-ods-writer"}}
                """.formatted(sourceId)).getResponse();
        org.assertj.core.api.Assertions.assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(response.getContentAsString());
        var source = body.path("config").path("source").get(0);
        org.assertj.core.api.Assertions.assertThat(source.path("query").asText())
                .isEqualTo("SELECT ID, NAME FROM SOURCES");
        org.assertj.core.api.Assertions.assertThat(source.path("url").asText()).isEqualTo(H2_URL);
        org.assertj.core.api.Assertions.assertThat(source.path("driver").asText()).isEqualTo("org.h2.Driver");
        // 源 credentialRef 由登记连接注入，不由任务侧重复填写
        org.assertj.core.api.Assertions.assertThat(source.has("credentialRef")).isTrue();
        var sink = body.path("config").path("sink").get(0);
        org.assertj.core.api.Assertions.assertThat(sink.path("database").asText()).isEqualTo("ods_lis");
        org.assertj.core.api.Assertions.assertThat(sink.path("table").asText()).isEqualTo("SOURCES");
        org.assertj.core.api.Assertions.assertThat(sink.path("sink.label-prefix").asText())
                .contains(jobId.replace("-", "").toLowerCase());
        // 意图与编译产物同存，水位未建立时如实为空
        org.assertj.core.api.Assertions.assertThat(body.path("structured").path("form").asText()).isEqualTo("TABLE");
        org.assertj.core.api.Assertions.assertThat(body.path("lastSuccessWatermark").isNull()).isTrue();
    }

    @Test
    void compilesIncrementalTaskWithWatermarkPlaceholdersAndAutoOrderKey() throws Exception {
        var sourceId = connectedSource();
        var jobId = createJob(sourceId);
        var response = saveStructured(jobId, """
                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                 "structured":{"form":"TABLE","sourceId":"%s","catalog":"DATAOS","tables":["SOURCES"],
                               "columns":["ID"],"orderKey":"CREATED_AT","mode":"INCREMENTAL",
                               "sinkFenodes":"doris-fe:8030","sinkCredentialRef":"doris-ods-writer"}}
                """.formatted(sourceId)).getResponse();
        org.assertj.core.api.Assertions.assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(response.getContentAsString());
        var query = body.path("config").path("source").get(0).path("query").asText();
        org.assertj.core.api.Assertions.assertThat(query)
                .isEqualTo("SELECT ID, CREATED_AT FROM SOURCES WHERE CREATED_AT >= '${last_success_time}'"
                        + " AND CREATED_AT < '${run_start_time}'");
        // 序列键同时是外部执行器的并行分片列
        org.assertj.core.api.Assertions.assertThat(
                body.path("config").path("source").get(0).path("partition_column").asText()).isEqualTo("CREATED_AT");
        // 白名单自动补入序列键并如实落库
        org.assertj.core.api.Assertions.assertThat(
                body.path("structured").path("columns").toString()).contains("CREATED_AT");
    }

    @Test
    void compilesSqlFormTaskWithReadOnlyValidation() throws Exception {
        var sourceId = connectedSource();
        var jobId = createJob(sourceId);
        var response = saveStructured(jobId, """
                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                 "structured":{"form":"SQL","sourceId":"%s","mode":"FULL",
                               "customSql":"SELECT ID AS source_id, NAME AS label FROM SOURCES",
                               "targetTable":"src_overview",
                               "sinkFenodes":"doris-fe:8030","sinkCredentialRef":"doris-ods-writer"}}
                """.formatted(sourceId)).getResponse();
        org.assertj.core.api.Assertions.assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = mapper.readTree(response.getContentAsString());
        org.assertj.core.api.Assertions.assertThat(body.path("config").path("source").get(0).path("query").asText())
                .contains("FROM SOURCES");

        // 写语句在保存前被拒（不执行）
        var write = saveStructured(jobId, """
                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                 "structured":{"form":"SQL","sourceId":"%s","mode":"FULL",
                               "customSql":"DELETE FROM data_os.sources",
                               "targetTable":"src_overview",
                               "sinkFenodes":"doris-fe:8030","sinkCredentialRef":"doris-ods-writer"}}
                """.formatted(sourceId)).getResponse();
                org.assertj.core.api.Assertions.assertThat(write.getStatus()).isEqualTo(400);
        org.assertj.core.api.Assertions.assertThat(write.getContentAsString()).contains("只读");
    }

    @Test
    void rejectsInvalidStructuredSpecsAgainstLiveCatalog() throws Exception {
        var sourceId = connectedSource();
        var jobId = createJob(sourceId);
        // 整数序列键走增量：无时间位点回放能力，如实拒绝
        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                                 "structured":{"form":"TABLE","sourceId":"%s","catalog":"DATAOS",
                                               "tables":["INGESTION_JOB_CONFIGS"],"columns":["JOB_ID"],
                                               "orderKey":"TEMPLATE_VERSION","mode":"INCREMENTAL",
                                               "sinkFenodes":"doris-fe:8030","sinkCredentialRef":"doris-ods-writer"}}
                                """.formatted(sourceId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("时间类型")));
        // 白名单列不存在
        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                                 "structured":{"form":"TABLE","sourceId":"%s","catalog":"DATAOS",
                                               "tables":["SOURCES"],"columns":["NO_SUCH_COLUMN"],"mode":"FULL",
                                               "sinkFenodes":"doris-fe:8030","sinkCredentialRef":"doris-ods-writer"}}
                                """.formatted(sourceId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("不存在")));
        // 源未登记连接
        mockMvc.perform(post("/api/v1/sources").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"裸源-" + UUID.randomUUID() + "\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andExpect(status().isCreated());
        var bare = mockMvc.perform(get("/api/v1/sources")).andReturn().getResponse();
        String bareId = null;
        for (JsonNode item : mapper.readTree(bare.getContentAsString()).path("items")) {
            if (item.path("name").asText().startsWith("裸源-")) bareId = item.path("id").asText();
        }
        org.assertj.core.api.Assertions.assertThat(bareId).isNotNull();
        mockMvc.perform(put("/api/v1/jobs/" + createJob(bareId) + "/config").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                                 "structured":{"form":"TABLE","sourceId":"%s","catalog":"DATAOS","tables":["SOURCES"],
                                               "mode":"FULL","sinkFenodes":"fe:8030","sinkCredentialRef":"w"}}
                                """.formatted(bareId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("尚未登记连接配置")));
        // 缺目标仓 FE 地址
        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                                 "structured":{"form":"TABLE","sourceId":"%s","catalog":"DATAOS","tables":["SOURCES"],
                                               "mode":"FULL","sinkCredentialRef":"w"}}
                                """.formatted(sourceId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("FE 地址")));
    }

    @Test
    void copiesStructuredJobWithRetargetedRecompilation() throws Exception {
        var sourceId = connectedSource();
        var jobId = createJob(sourceId);
        saveStructured(jobId, """
                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                 "structured":{"form":"TABLE","sourceId":"%s","catalog":"DATAOS","tables":["SOURCES"],
                               "columns":["ID"],"mode":"FULL",
                               "sinkFenodes":"doris-fe:8030","sinkCredentialRef":"doris-ods-writer"}}
                """.formatted(sourceId));
        var copy = mockMvc.perform(post("/api/v1/jobs/" + jobId + "/copy")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"复制后的采集口径\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("DRAFT")))
                .andReturn().getResponse().getContentAsString();
        var copyId = mapper.readTree(copy).path("id").asText();
        mockMvc.perform(get("/api/v1/jobs/" + copyId + "/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.structured.tables[0]", is("SOURCES")))
                .andExpect(jsonPath("$.structured.form", is("TABLE")))
                .andExpect(jsonPath("$.config.source[0].query", is("SELECT ID FROM SOURCES")))
                // label-prefix 按新 job 派生（幂等标签互不串扰）
                .andExpect(jsonPath("$.config.sink[0]['sink.label-prefix']", containsString(
                        copyId.replace("-", "").toLowerCase())))
                .andExpect(jsonPath("$.lastSuccessWatermark", nullValue()));
        // 复制到不存在的源：404 且不留半份任务
        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/copy")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"no-such-source\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void jsonOverwriteDropsStructuredIntentExplicitly() throws Exception {
        var sourceId = connectedSource();
        var jobId = createJob(sourceId);
        saveStructured(jobId, """
                {"templateKey":"STRUCTURED_JDBC_TO_DORIS",
                 "structured":{"form":"TABLE","sourceId":"%s","catalog":"DATAOS","tables":["SOURCES"],
                               "mode":"FULL","sinkFenodes":"doris-fe:8030","sinkCredentialRef":"doris-ods-writer"}}
                """.formatted(sourceId));
        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"templateKey":"CUSTOM_JSON","templateVersion":1,
                                 "config":{"env":{"job.mode":"BATCH"},
                                           "source":[{"plugin_name":"Jdbc","url":"jdbc:h2:mem:x","query":"SELECT 1"}],
                                           "transform":[],
                                           "sink":[{"plugin_name":"Doris","fenodes":"fe:8030"}]}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.structured", nullValue()))
                .andExpect(jsonPath("$.templateKey", is("CUSTOM_JSON")));
    }
}
