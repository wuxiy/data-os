package com.cywu.dataos.controlplane.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

/**
 * HttpAIReadyEngineAdapter 契约：/assess 调用、workflowType->profile 映射、
 * 引擎不可达映射 AdapterUnavailableException（advice -> 503）。
 */
class AIReadyEngineAdapterTest {

    private HttpServer server;
    private AIReadyEngineConfiguration configuration;
    private AIReadyProperties properties;
    private String lastBody;

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/assess", exchange -> {
            lastBody = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            var report = """
                    {"product":"临床指南 RAG 语料库","version":"v0.1.0","profile":"medical-rag",
                     "assessedAt":"2026-08-27T10:00:00+00:00",
                     "requirements":[],"dimensions":{"clean":1.0},"overall":1.0,
                     "gate":{"overall":1.0,"result":"PASS","certification":"CANDIDATE","criticalFailures":[]},
                     "problems":{}}
                    """;
            var bytes = report.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (var output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        });
        server.start();
        properties = new AIReadyProperties();
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.setApiToken("test-token");
        configuration = new AIReadyEngineConfiguration();
    }

    @AfterEach
    void stopStub() {
        server.stop(0);
    }

    private AIDataProduct product(String workflowType) {
        return new AIDataProduct("id-1", "default", "p", AIDataProductType.RAG_CORPUS,
                "owner", workflowType, "source", "v0.1.0", AIDataProductLifecycle.DRAFT, null, null);
    }

    @Test
    void assessesCurrentVersionAndParsesReport() throws Exception {
        var engine = configuration.aiReadyEnginePort(properties, RestClient.builder());

        var assessment = engine.build(product("MEDICAL_RAG"), "recipes/medical-rag-v1.yaml");

        assertThat(assessment.overall()).isEqualTo(1.0);
        assertThat(assessment.certification()).isEqualTo("CANDIDATE");
        assertThat(assessment.profile()).isEqualTo("medical-rag");
        assertThat(assessment.rawJson()).containsKey("dimensions");
        var request = new ObjectMapper().readTree(lastBody);
        assertThat(request.get("version").asText()).isEqualTo("v0.1.0");
        assertThat(request.get("profile").asText()).isEqualTo("medical-rag");
        assertThat(request.get("recipeRef").asText()).isEqualTo("recipes/medical-rag-v1.yaml");
    }

    @Test
    void unknownWorkflowIsPassedThroughForEngineToReject() throws Exception {
        var engine = configuration.aiReadyEnginePort(properties, RestClient.builder());
        // profile 词汇表唯一源在引擎声明仓库：Java 只做拼写归一，未知值透传。
        engine.build(product("SOMETHING_ELSE"), null);
        assertThat(new ObjectMapper().readTree(lastBody).get("profile").asText())
                .isEqualTo("something-else");
    }

    @Test
    void engineRejectionMapsToInvalidRequestNotUnavailable() {
        server.removeContext("/assess");
        server.createContext("/assess", exchange -> {
            var bytes = "{\"detail\":\"未知 Profile：something-else（profiles/ 未定义）\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(422, bytes.length);
            try (var output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        });
        var engine = configuration.aiReadyEnginePort(properties, RestClient.builder());

        assertThatThrownBy(() -> engine.build(product("SOMETHING_ELSE"), null))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("未知 Profile");
    }

    @Test
    void unreachableEngineMapsToAdapterUnavailable() {
        properties.setBaseUrl("http://127.0.0.1:1");
        var engine = configuration.aiReadyEnginePort(properties, RestClient.builder());

        assertThatThrownBy(() -> engine.build(product("MEDICAL_RAG"), null))
                .isInstanceOf(AdapterUnavailableException.class);
    }
}
