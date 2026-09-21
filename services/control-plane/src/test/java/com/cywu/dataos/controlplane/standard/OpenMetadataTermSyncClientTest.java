package com.cywu.dataos.controlplane.standard;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cywu.dataos.controlplane.lineage.OpenMetadataLineageProperties;

/**
 * OM 术语投影客户端（G22）：词表查找、同名术语 409 幂等、失败抛出（服务层落
 * SYNC_PENDING），与 SupersetGuestTokenServiceTest 同款本地 HttpServer 桩。
 */
class OpenMetadataTermSyncClientTest {

    private com.sun.net.httpserver.HttpServer server;
    private OpenMetadataTermSyncClient client;
    private final AtomicInteger conflicts = new AtomicInteger();
    private final AtomicReference<String> lastTermBody = new AtomicReference<>();
    private volatile boolean failGlossary;

    @BeforeEach
    void startStub() throws IOException {
        server = com.sun.net.httpserver.HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/glossaries", exchange -> {
            if (failGlossary) {
                exchange.sendResponseHeaders(500, -1);
                return;
            }
            respond(exchange, "{\"data\":[{\"id\":\"gloss-1\",\"name\":\"数据标准\"}]}");
        });
        server.createContext("/api/v1/glossaryTerms", exchange -> {
            lastTermBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            if (conflicts.getAndDecrement() > 0) {
                exchange.sendResponseHeaders(409, -1);
                return;
            }
            respond(exchange, "{\"id\":\"term-1\"}");
        });
        server.start();
        var properties = new OpenMetadataLineageProperties();
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1");
        properties.setTokenUri("");   // 免 token 桩
        client = new StandardOmSyncConfiguration().openMetadataTermSyncClient(
                org.springframework.web.client.RestClient.builder(), properties);
    }

    @AfterEach
    void stopStub() {
        server.stop(0);
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String body) throws IOException {
        var bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static List<DataStandardElement> elements() {
        return List.of(new DataStandardElement("e1", "v1", "channel", "挂号渠道", "CODE", true,
                "定义", "NORMAL", "", 0, Instant.now(),
                List.of(new DataStandardValue("s1", "e1", "OPD", "门诊", "", "", 0, Instant.now()))));
    }

    @Test
    void pushesTermsAndTreatsConflictAsIdempotent() {
        conflicts.set(1);  // 第一次 409（已存在），第二次成功 —— 幂等口径
        client.pushTerms("reg-channel", 3, elements());
        assertThat(lastTermBody.get()).contains("\"reg-channel.channel\"").contains("gloss-1");
    }

    @Test
    void glossaryFailureSurfacesAsException() {
        failGlossary = true;
        assertThatThrownBy(() -> client.pushTerms("reg-channel", 3, elements()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("OM 词表查询失败");
    }

    @Test
    void missingGlossarySurfacesAsException() {
        // 返回体里没有目标词表 → 明确报「词表不存在」（发布侧落 SYNC_PENDING 并提示建词表）
        server.removeContext("/api/v1/glossaries");
        server.createContext("/api/v1/glossaries", exchange ->
                respond(exchange, "{\"data\":[]}"));
        assertThatThrownBy(() -> client.pushTerms("reg-channel", 3, elements()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("词表「数据标准」不存在");
    }
}
