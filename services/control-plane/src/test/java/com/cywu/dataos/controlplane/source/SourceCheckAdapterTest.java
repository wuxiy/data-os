package com.cywu.dataos.controlplane.source;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.Map;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SourceCheckAdapterTest {

    private HttpServer server;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/health", exchange -> {
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void checksReachableHttpSource() {
        var source = source("HTTP");
        var result = new HttpSourceCheckAdapter().check(source,
                Map.of("url", "http://127.0.0.1:" + server.getAddress().getPort() + "/health"));

        assertEquals("HEALTHY", result.status());
        assertTrue(result.message().contains("HTTP 服务可访问"));
    }

    @Test
    void treatsFhirAsHttpCompatibleProtocol() {
        assertTrue(new HttpSourceCheckAdapter().supports("FHIR"));
    }

    private Source source(String protocol) {
        return new Source("source-1", "default", "demo-hospital", "测试来源", "LIS", protocol,
                "PENDING", Instant.now(), null, null);
    }
}
