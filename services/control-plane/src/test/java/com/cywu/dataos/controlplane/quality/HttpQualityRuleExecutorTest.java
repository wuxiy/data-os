package com.cywu.dataos.controlplane.quality;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class HttpQualityRuleExecutorTest {

    @Test
    void supportsDbtContractAndMapsSubmissionAndEvidence() throws Exception {
        var requests = new AtomicInteger();
        var server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/api/v1/quality/runs", exchange -> {
            var request = new String(exchange.getRequestBody().readAllBytes());
            assertThat(request).contains("\"executionBatchId\":\"qr-test-001\"");
            assertThat(exchange.getRequestHeaders().getFirst("Idempotency-Key")).isEqualTo("qr-test-001");
            var body = "{\"runId\":\"runner-001\",\"message\":\"accepted\"}";
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(202, body.length());
            exchange.getResponseBody().write(body.getBytes());
            exchange.close();
            requests.incrementAndGet();
        });
        server.createContext("/api/v1/quality/runs/runner-001", exchange -> {
            var body = """
                    {"status":"success","passed":true,"message":"ok","batchId":"qr-test-001",
                     "sampleEvidence":[{"row":"patient-001","field":"result_time"}],
                     "startedAt":"2026-08-05T09:00:00+08:00","finishedAt":"2026-08-05T09:00:02+08:00",
                     "artifactUri":"s3://dataos-quality-artifacts/quality-runs/runner-001/summary.json"}
                    """;
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length());
            exchange.getResponseBody().write(body.getBytes());
            exchange.close();
        });
        server.start();
        try {
            var executor = new HttpQualityRuleExecutor(RestClient.builder(),
                    "http://127.0.0.1:" + server.getAddress().getPort());
            assertThat(executor.supports("DBT")).isTrue();
            var submission = executor.submit(new QualityRuleExecutionRequest(
                    "issue-001", "default", "demo-hospital", "测试问题", "rule-pass", "asset-001", "qr-test-001"));
            assertThat(submission.externalId()).isEqualTo("runner-001");
            var result = executor.status(submission.externalId());
            assertThat(result.status()).isEqualTo("SUCCEEDED");
            assertThat(result.passed()).isTrue();
            assertThat(result.executionBatchId()).isEqualTo("qr-test-001");
            assertThat(result.sampleEvidence()).hasSize(1);
            assertThat(result.artifactUri()).isEqualTo("s3://dataos-quality-artifacts/quality-runs/runner-001/summary.json");
            assertThat(requests).hasValue(1);
        } finally {
            server.stop(0);
        }
    }
}
