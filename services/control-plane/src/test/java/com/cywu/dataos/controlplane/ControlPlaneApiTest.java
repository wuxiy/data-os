package com.cywu.dataos.controlplane;

import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/runs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status", is("BLOCKED_DEPENDENCY")))
                .andExpect(jsonPath("$.executor", is("SEATUNNEL")));

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/runs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total", is(1)))
                .andExpect(jsonPath("$.items[0].message", is("中心采集执行器未配置")));
    }
}
