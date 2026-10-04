package com.cywu.dataos.controlplane.edge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * G2G 批次 4 第二刀契约测试：发布记录（登记面）+ 采集水位代理（stub runner）。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class EdgeDeploymentApiTest {

    private static HttpServer runner;
    private static volatile String watermarkBody = """
            {"asOf":"2026-10-04T06:00:00Z","tables":[
              {"key":"cfzb","dataset":"ods_ep.ep_mz_cfzb_edge","totalRows":12034,
               "latestWriteAt":"2026-10-04 05:30:00",
               "dailyCounts":[{"date":"2026-10-03","count":412}]}]}
            """;

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper mapper = JsonMapper.builder().build();

    @BeforeAll
    static void startStubRunner() throws IOException {
        runner = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        runner.createContext("/api/v1/edge/watermarks", exchange -> {
            var bytes = watermarkBody.getBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        runner.start();
    }

    @AfterAll
    static void stopStubRunner() {
        runner.stop(0);
    }

    @DynamicPropertySource
    static void runnerBaseUrl(DynamicPropertyRegistry registry) {
        registry.add("data-os.quality.base-url",
                () -> "http://127.0.0.1:" + runner.getAddress().getPort());
    }

    private String registerNode(String name) throws Exception {
        MvcResult result = mockMvc.perform(put("/api/v1/edge/nodes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"%s","host":"127.0.0.1","port":8443}
                                """.formatted(name)))
                .andExpect(status().isCreated())
                .andReturn();
        return mapper.readTree(result.getResponse().getContentAsString()).path("id").asText();
    }

    @Test
    void recordsAndListsDeploymentsPerNode() throws Exception {
        var nodeId = registerNode("发布节点-" + UUID.randomUUID().toString().substring(0, 8));
        mockMvc.perform(get("/api/v1/edge/nodes/" + nodeId + "/deployments"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(0)));

        mockMvc.perform(post("/api/v1/edge/nodes/" + nodeId + "/deployments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"version":"minifi-1.22-flow-v3","artifactRef":"deploy/minifi@2026-10",
                                 "note":"更换 EP 采集流并调大批次"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].version", is("minifi-1.22-flow-v3")))
                .andExpect(jsonPath("$[0].deployedBy", is("local-development")));

        // 节点不存在 → 404；版本缺省 → 400
        mockMvc.perform(post("/api/v1/edge/nodes/no-such-node/deployments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":\"v1\"}"))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/edge/nodes/" + nodeId + "/deployments")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void watermarksProxyRunnerAggregates() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/v1/edge/nodes/watermarks"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode body = mapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.path("tables").get(0).path("dataset").asText())
                .isEqualTo("ods_ep.ep_mz_cfzb_edge");
        assertThat(body.path("tables").get(0).path("totalRows").asInt()).isEqualTo(12034);
        assertThat(body.path("tables").get(0).path("dailyCounts").get(0).path("count").asInt())
                .isEqualTo(412);
    }
}
