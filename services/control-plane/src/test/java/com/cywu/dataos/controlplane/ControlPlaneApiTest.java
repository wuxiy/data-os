package com.cywu.dataos.controlplane;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.Timestamp;
import java.time.Instant;

import org.springframework.jdbc.core.JdbcTemplate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.BEFORE_EACH_TEST_METHOD)
class ControlPlaneApiTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void registersAndListsSourceThroughPublicApi() throws Exception {
        mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "tenantId":"default",
                                  "institutionId":"demo-hospital",
                                  "name":"LIS",
                                  "systemType":"LIS",
                                  "protocol":"JDBC"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("/api/v1/sources/")))
                .andExpect(jsonPath("$.status", is("PENDING")));

        mockMvc.perform(get("/api/v1/sources")
                        .param("tenantId", "default")
                        .param("institutionId", "demo-hospital"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(1)))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].protocol", is("JDBC")));
    }

    @Test
    void returnsGovernanceSummaryFromControlDatabase() throws Exception {
        mockMvc.perform(get("/api/v1/governance/summary"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenantId", is("default")))
                .andExpect(jsonPath("$.institutionId", is("demo-hospital")))
                .andExpect(jsonPath("$.metrics", hasSize(0)))
                .andExpect(jsonPath("$.issues", hasSize(0)));
    }

    @Test
    void validatesSourceRequiredFields() throws Exception {
        mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("VALIDATION_ERROR")))
                .andExpect(jsonPath("$.fields.name", is("name 不能为空")));
    }

    @Test
    void recordsBlockedRunWhenExecutorIsNotConfigured() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"运行测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"运行测试作业\"}"))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        var runResponse = mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")))
                .andExpect(jsonPath("$.executor", is("SEATUNNEL")))
                .andReturn().getResponse().getContentAsString();
        var runId = runResponse.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs/" + runId + "/sync"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")))
                .andExpect(jsonPath("$.message", is("中心采集执行器未配置")));

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(1)))
                .andExpect(jsonPath("$.items[0].message", is("中心采集执行器未配置")));
    }

    @Test
    void rejectsDuplicateActiveRunForSameJob() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"重复运行源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"重复运行作业\"}"))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT INTO data_os.job_runs
                    (id, job_id, status, executor, external_id, message, submitted_at, started_at, finished_at)
                VALUES (?, ?, 'SUBMITTED', 'SEATUNNEL', 'external-active', '中心采集作业已提交', ?, ?, NULL)
                """, "active-run", jobId, now, now);

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code", is("CONFLICT")));
    }

    @Test
    void persistsAndUpdatesTaskConfigurationThroughPublicApi() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"配置测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "sourceId":"%s",
                                  "name":"可配置任务",
                                  "mode":"BATCH",
                                  "templateKey":"FAKE_TO_CONSOLE",
                                  "templateVersion":1,
                                  "config":{
                                    "env":{"job.mode":"BATCH","parallelism":1},
                                    "source":[{"plugin_name":"FakeSource","plugin_output":"fake","row.num":2}],
                                    "transform":[],
                                    "sink":[{"plugin_name":"Console","plugin_input":["fake"]}]
                                  }
                                }
                                """.formatted(sourceId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.configured", is(true)))
                .andExpect(jsonPath("$.templateKey", is("FAKE_TO_CONSOLE")))
                .andExpect(jsonPath("$.templateVersion", is(1)))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.templateKey", is("FAKE_TO_CONSOLE")))
                .andExpect(jsonPath("$.config.source[0].plugin_name", is("FakeSource")));

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "templateKey":"FAKE_TO_CONSOLE",
                                  "templateVersion":1,
                                  "config":{
                                    "env":{"job.mode":"BATCH","parallelism":1},
                                    "source":[{"plugin_name":"FakeSource","plugin_output":"fake","row.num":4}],
                                    "transform":[],
                                    "sink":[{"plugin_name":"Console","plugin_input":["fake"]}]
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.config.source[0]['row.num']", is(4)));

        mockMvc.perform(get("/api/v1/jobs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].configured", is(true)));
    }

    @Test
    void rejectsPlaintextSecretsInTaskConfiguration() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"敏感配置测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "sourceId":"%s",
                                  "name":"不应保存密码的任务",
                                  "templateKey":"CUSTOM_JSON",
                                  "config":{
                                    "env":{"job.mode":"BATCH"},
                                    "source":[{"plugin_name":"Jdbc" ,"password":"not-a-secret"}],
                                    "sink":[{"plugin_name":"Console"}]
                                  }
                                }
                                """.formatted(sourceId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_REQUEST")))
                .andExpect(jsonPath("$.message", is("任务配置不得保存明文密码或密钥，请改用凭据引用")));
    }

    @Test
    void rejectsInvalidTemplateVersionOnJobCreation() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"版本测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "sourceId":"%s",
                                  "name":"非法版本任务",
                                  "templateKey":"CUSTOM_JSON",
                                  "templateVersion":0,
                                  "config":{
                                    "env":{"job.mode":"BATCH"},
                                    "source":[{"plugin_name":"FakeSource"}],
                                    "sink":[{"plugin_name":"Console"}]
                                  }
                                }
                                """.formatted(sourceId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code", is("INVALID_REQUEST")))
                .andExpect(jsonPath("$.message", is("templateVersion 必须大于 0")));
    }

    @Test
    void replaysRunForSameIdempotencyKey() throws Exception {
        var source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"幂等测试源\",\"systemType\":\"LIS\",\"protocol\":\"JDBC\"}"))
                .andReturn().getResponse().getContentAsString();
        var sourceId = source.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"幂等测试任务\"}"))
                .andReturn().getResponse().getContentAsString();
        var jobId = job.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");
        var request = post("/api/v1/jobs/" + jobId + "/runs")
                .header("Idempotency-Key", "run-key-1")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}");

        var first = mockMvc.perform(request)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        var firstRunId = first.replaceAll(".*\\\"id\\\":\\\"([^\\\"]+)\\\".*", "$1");

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .header("Idempotency-Key", "run-key-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id", is(firstRunId)));

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .header("Idempotency-Key", "run-key-1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"config\":{\"env\":{\"job.mode\":\"BATCH\"}}}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code", is("CONFLICT")));

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(1)));
    }
}
