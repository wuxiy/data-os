package com.cywu.dataos.controlplane.executor;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import com.cywu.dataos.controlplane.job.IngestionJob;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class SeaTunnelExecutorAdapterTest {

    @Test
    void mapsPlatformCdcModeToSeaTunnelStreamingMode() {
        assertThat(SeaTunnelExecutorAdapter.toSeaTunnelMode("CDC")).isEqualTo("STREAMING");
    }

    @Test
    void submitsNormalizedModeAndEndpointWithoutDoubleSlash() throws IOException {
        var requestBody = new AtomicReference<String>();
        var requests = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/submit-job", exchange -> {
            requests.incrementAndGet();
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            var response = "{\"jobId\":\"seatunnel-123\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        try {
            var adapter = new SeaTunnelExecutorAdapter(
                    RestClient.builder(), "http://127.0.0.1:" + server.getAddress().getPort() + "/", "UTC");
            var job = new IngestionJob("job-1", "source-1", "门诊 CDC", "CDC", "SEATUNNEL",
                    "ACTIVE", null, null, null);

            var submission = adapter.submit(job, Map.of("source", Map.of("plugin_name", "FakeSource"),
                    "env", Map.of("job.mode", "CDC")));

            assertThat(submission.externalId()).isEqualTo("seatunnel-123");
            assertThat(requests).hasValue(1);
            assertThat(requestBody).hasValueSatisfying(body -> {
                assertThat(body).contains("\"job.mode\":\"STREAMING\"");
                assertThat(body).contains("\"job.name\":\"门诊 CDC\"");
            });
        } finally {
            server.stop(0);
        }
    }

    @Test
    void mapsSeaTunnelFinishedStatusToSucceeded() throws IOException {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/job-info/seatunnel-123", exchange -> {
            var response = """
                    {"jobId":"seatunnel-123","jobStatus":"FINISHED","errorMsg":null,
                     "createTime":"2026-08-03 09:00:00","finishedTime":"2026-08-03 09:00:02"}
                    """.replace("\n", "").replace("\r", "").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            try (var output = exchange.getResponseBody()) {
                output.write(response);
            }
        });
        server.start();
        try {
            var adapter = new SeaTunnelExecutorAdapter(
                    RestClient.builder(), "http://127.0.0.1:" + server.getAddress().getPort(), "UTC");

            var status = adapter.status("seatunnel-123");

            assertThat(status.status()).isEqualTo("SUCCEEDED");
            assertThat(status.message()).isEqualTo("中心采集作业已完成");
            assertThat(status.startedAt()).isNull();
            assertThat(status.finishedAt()).isNotNull();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void mapsMissingExternalJobToManualReviewStatus() throws IOException {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/job-info/missing", exchange -> {
            exchange.sendResponseHeaders(404, -1);
            exchange.close();
        });
        server.start();
        try {
            var adapter = new SeaTunnelExecutorAdapter(
                    RestClient.builder(), "http://127.0.0.1:" + server.getAddress().getPort(), "UTC");

            var status = adapter.status("missing");

            assertThat(status.status()).isEqualTo("UNKNOWN");
            assertThat(status.message()).isEqualTo("中心采集作业暂未找到，请人工重试");
        } finally {
            server.stop(0);
        }
    }
}
