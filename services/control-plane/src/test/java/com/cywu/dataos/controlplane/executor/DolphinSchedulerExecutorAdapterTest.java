package com.cywu.dataos.controlplane.executor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.cywu.dataos.controlplane.job.IngestionJob;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class DolphinSchedulerExecutorAdapterTest {

    @Test
    void supportsDolphinSchedulerExecutorNames() {
        var adapter = new DolphinSchedulerExecutorAdapter(RestClient.builder(), "", "", "UTC");

        assertThat(adapter.supports("DOLPHINSCHEDULER")).isTrue();
        assertThat(adapter.supports("dolphin_scheduler")).isTrue();
        assertThat(adapter.supports("SEATUNNEL")).isFalse();
    }

    @Test
    void submitsPublishedWorkflowAndKeepsTokenOutOfRequestBody() throws IOException {
        var requestPath = new AtomicReference<String>();
        var requestToken = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/projects/7/executors/start-workflow-instance", exchange -> {
            requestPath.set(exchange.getRequestURI().toString());
            requestToken.set(exchange.getRequestHeaders().getFirst("token"));
            var response = "{\"code\":0,\"msg\":\"success\",\"data\":[123]}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        try {
            var adapter = new DolphinSchedulerExecutorAdapter(
                    RestClient.builder(),
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "runtime-token",
                    "UTC");
            var job = new IngestionJob("job-1", "source-1", "门诊批处理", "BATCH", "DOLPHINSCHEDULER",
                    "ACTIVE", null, null, null, null, null, false);

            var submission = adapter.submit(job, Map.of("dolphinscheduler", Map.of(
                    "projectCode", 7,
                    "workflowDefinitionCode", 9,
                    "startParams", Map.of("data_domain", "检验"))), "run-1");

            assertThat(submission.externalId()).isEqualTo("ds|7|9|123");
            assertThat(requestToken).hasValue("runtime-token");
            assertThat(requestPath).hasValueSatisfying(path -> {
                assertThat(path).contains("workflowDefinitionCode=9");
                assertThat(path).contains("failureStrategy=CONTINUE");
                assertThat(path).contains("startParams=");
                assertThat(path).contains("dataos_run_id");
            });
        } finally {
            server.stop(0);
        }
    }

    @Test
    void fallsBackToSessionLoginWhenTokenIsNotConfigured() throws IOException {
        var loginSeen = new AtomicReference<Boolean>(false);
        var cookieSeen = new AtomicReference<String>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/login", exchange -> {
            loginSeen.set(true);
            var response = "{\"code\":0,\"msg\":\"success\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Set-Cookie", "sessionId=session-1; Path=/; HttpOnly");
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.createContext("/projects/7/executors/start-workflow-instance", exchange -> {
            cookieSeen.set(exchange.getRequestHeaders().getFirst("Cookie"));
            var response = "{\"code\":0,\"data\":[321]}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        try {
            var adapter = new DolphinSchedulerExecutorAdapter(
                    RestClient.builder(),
                    new com.fasterxml.jackson.databind.ObjectMapper(),
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "", "svc-user", "svc-password", "UTC", true);
            var job = new IngestionJob("job-1", "source-1", "门诊批处理", "BATCH", "DOLPHINSCHEDULER",
                    "ACTIVE", null, null, null, null, null, false);

            var submission = adapter.submit(job, Map.of("dolphinscheduler", Map.of(
                    "projectCode", 7, "workflowDefinitionCode", 9)), "run-2");

            assertThat(submission.externalId()).isEqualTo("ds|7|9|321");
            assertThat(loginSeen).hasValue(true);
            assertThat(cookieSeen).hasValue("sessionId=session-1");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void mapsWorkflowSuccessToSucceeded() throws IOException {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/projects/7/workflow-instances/123", exchange -> {
            var response = """
                    {"code":0,"data":{"state":"SUCCESS","startTime":"2026-08-07 10:00:00",
                    "endTime":"2026-08-07 10:00:03"}}
                    """.replace("\n", "").replace("\r", "").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        try {
            var adapter = new DolphinSchedulerExecutorAdapter(
                    RestClient.builder(),
                    "http://127.0.0.1:" + server.getAddress().getPort(),
                    "runtime-token",
                    "Asia/Shanghai");

            var status = adapter.status("ds|7|9|123");

            assertThat(status.status()).isEqualTo("SUCCEEDED");
            assertThat(status.message()).isEqualTo("DolphinScheduler 工作流已完成");
            assertThat(status.startedAt()).isNotNull();
            assertThat(status.finishedAt()).isNotNull();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsUnboundWorkflowAndMalformedExternalId() {
        var adapter = new DolphinSchedulerExecutorAdapter(RestClient.builder(), "http://127.0.0.1:1", "token", "UTC");
        var job = new IngestionJob("job-1", "source-1", "批处理", "BATCH", "DOLPHINSCHEDULER",
                "ACTIVE", null, null, null, null, null, false);

        assertThatThrownBy(() -> adapter.submit(job, Map.of()))
                .isInstanceOf(AdapterConfigurationException.class)
                .hasMessageContaining("工作流绑定");
        assertThatThrownBy(() -> adapter.status("seatunnel-123"))
                .isInstanceOf(AdapterConfigurationException.class)
                .hasMessageContaining("格式不合法");
    }

    @Test
    void normalizesDolphinSchedulerStates() {
        assertThat(DolphinSchedulerExecutorAdapter.normalizeStatus("RUNNING_EXECUTION")).isEqualTo("RUNNING");
        assertThat(DolphinSchedulerExecutorAdapter.normalizeStatus("SUCCESS")).isEqualTo("SUCCEEDED");
        assertThat(DolphinSchedulerExecutorAdapter.normalizeStatus("FAILURE")).isEqualTo("FAILED");
        assertThat(DolphinSchedulerExecutorAdapter.normalizeStatus("STOP")).isEqualTo("CANCELED");
    }
}
