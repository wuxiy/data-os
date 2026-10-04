package com.cywu.dataos.controlplane.edge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * G2G 批次 4 契约测试：前置机节点台账 + 中心 TCP 探活。正路径用本地
 * ServerSocket 真实监听，负路径用未监听端口；SSRF/明文配置沿用既有守卫口径。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class EdgeNodeApiTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper mapper = JsonMapper.builder().build();

    private String register(String name, int port, String config) throws Exception {
        MvcResult result = mockMvc.perform(put("/api/v1/edge/nodes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"%s","groupName":"市一院前置机","site":"本部","host":"127.0.0.1",
                                 "port":%d,"version":"minifi-0.x","config":%s}
                                """.formatted(name, port, config)))
                .andExpect(status().isCreated())
                .andReturn();
        return mapper.readTree(result.getResponse().getContentAsString()).path("id").asText();
    }

    @Test
    void registersListsAndDerivesUnknownState() throws Exception {
        var name = "前置机-" + UUID.randomUUID().toString().substring(0, 8);
        var id = register(name, 8443, """
                {"relayPrefix":"/ep-edge/","siteLabel":"本部机房"}""");
        MvcResult listed = mockMvc.perform(get("/api/v1/edge/nodes"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode mine = null;
        for (JsonNode item : mapper.readTree(listed.getResponse().getContentAsString()).path("items")) {
            if (id.equals(item.path("id").asText())) mine = item;
        }
        assertThat(mine).isNotNull();
        assertThat(mine.path("state").asText()).isEqualTo("UNKNOWN");
        assertThat(mine.path("lastProbeAt").isNull()).isTrue();
        assertThat(mine.path("config").path("relayPrefix").asText()).isEqualTo("/ep-edge/");
        assertThat(mine.path("config").has("password")).isFalse();
    }

    @Test
    void probesReachableAndUnreachableTargets() throws Exception {
        // 正路径：本地真实监听端口
        try (var server = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            var port = server.getLocalPort();
            var id = register("可达前置机-" + UUID.randomUUID().toString().substring(0, 6), port, "{}");
            mockMvc.perform(post("/api/v1/edge/nodes/" + id + "/probe"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.state", is("ONLINE")))
                    .andExpect(jsonPath("$.lastProbeAt", notNullValue()))
                    .andExpect(jsonPath("$.lastProbeMessage", containsString("端口可达")));
        }
        // 负路径：未监听端口（IANA 保留段，几乎不可能被占用）
        var id = register("离线前置机-" + UUID.randomUUID().toString().substring(0, 6), 1, "{}");
        mockMvc.perform(post("/api/v1/edge/nodes/" + id + "/probe"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state", is("OFFLINE")))
                .andExpect(jsonPath("$.lastProbeOk", is(false)))
                .andExpect(jsonPath("$.lastProbeMessage", containsString("探测失败")));
    }

    @Test
    void rejectsBlockedHostsAndSecretConfigs() throws Exception {
        mockMvc.perform(put("/api/v1/edge/nodes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"元数据前置机","host":"169.254.169.254","port":8080}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("禁止访问")));
        mockMvc.perform(put("/api/v1/edge/nodes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"带密前置机","host":"127.0.0.1","port":8443,
                                 "config":{"password":"plain-secret"}}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message", containsString("明文密码")));
        mockMvc.perform(put("/api/v1/edge/nodes")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"缺端口前置机","host":"127.0.0.1"}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void updatesKeepProbeHistoryAndDeleteRemoves() throws Exception {
        try (var server = new ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            var id = register("更新前置机-" + UUID.randomUUID().toString().substring(0, 6),
                    server.getLocalPort(), "{}");
            mockMvc.perform(post("/api/v1/edge/nodes/" + id + "/probe"))
                    .andExpect(jsonPath("$.state", is("ONLINE")));
            // 更新名称（探测历史保留）
            mockMvc.perform(put("/api/v1/edge/nodes/" + id)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {"name":"更新后前置机-%s","host":"127.0.0.1","port":%d}
                                    """.formatted(id.substring(0, 6), server.getLocalPort())))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.lastProbeOk", is(true)))
                    .andExpect(jsonPath("$.state", is("ONLINE")));
            mockMvc.perform(delete("/api/v1/edge/nodes/" + id))
                    .andExpect(status().isNoContent());
            mockMvc.perform(post("/api/v1/edge/nodes/" + id + "/probe"))
                    .andExpect(status().isNotFound());
        }
    }

    @Test
    void updateMissingNodeReturns404() throws Exception {
        mockMvc.perform(put("/api/v1/edge/nodes/no-such-node")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":"不存在的更新","host":"127.0.0.1","port":8443}
                                """))
                .andExpect(status().isNotFound());
    }
}
