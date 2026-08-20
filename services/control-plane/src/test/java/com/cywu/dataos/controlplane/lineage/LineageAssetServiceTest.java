package com.cywu.dataos.controlplane.lineage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

class LineageAssetServiceTest {

    private HttpServer server;
    private LineageAssetService service;
    private final AtomicReference<String> lastPath = new AtomicReference<>();

    @BeforeEach
    void startStub() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            lastPath.set(exchange.getRequestURI().toString());
            String response = "{}";
            var path = exchange.getRequestURI().getPath();
            var query = exchange.getRequestURI().getQuery() == null ? "" : exchange.getRequestURI().getQuery();
            if (path.endsWith("/tables") && query.contains("database=")) {
                response = """
                        {"data":[
                          {"name":"ep_mz_cfzb","fullyQualifiedName":"doris-dataos.default.ods_ep.ep_mz_cfzb",
                           "displayName":"处方主表","updatedAt":1787190000000,"updatedBy":"ingestion-bot",
                           "columns":[{"name":"YLJGDM","dataType":"VARCHAR","dataTypeDisplay":"varchar(20)"},
                                      {"name":"CFBH","dataType":"VARCHAR","dataTypeDisplay":"varchar(32)"},
                                      {"name":"PATIENT_ID","dataType":"VARCHAR","dataTypeDisplay":"varchar(32)"}]},
                          {"name":"ep_mz_ypcfmx","fullyQualifiedName":"doris-dataos.default.ods_ep.ep_mz_ypcfmx",
                           "updatedAt":1787190000001,"updatedBy":"ingestion-bot",
                           "columns":[{"name":"YLJGDM","dataType":"VARCHAR","dataTypeDisplay":"varchar(20)"}]}
                        ]}
                        """;
            } else if (path.contains("/tables/name/")) {
                if (path.contains("missing")) {
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    var notFound = "{\"code\":404}".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(404, notFound.length);
                    try (var output = exchange.getResponseBody()) {
                        output.write(notFound);
                    }
                    return;
                }
                response = """
                        {"name":"ep_mz_cfzb","fullyQualifiedName":"doris-dataos.default.ods_ep.ep_mz_cfzb",
                         "displayName":"处方主表","description":"EP 处方主表",
                         "updatedAt":1787190000000,
                         "columns":[{"name":"YLJGDM","dataType":"VARCHAR","dataTypeDisplay":"varchar(20)","description":"机构代码"}]}
                        """;
            } else if (path.contains("/lineage/table/name/")) {
                if (query.startsWith("upstreamDepth")) {
                    response = """
                            {"nodes":[
                              {"id":"m1","entityType":"dashboardDataModel","fullyQualifiedName":"superset-dataos.model.2"},
                              {"id":"d1","entityType":"dashboard","fullyQualifiedName":"superset-dataos.2"}
                            ],"edges":[]}
                            """;
                } else {
                    response = "{\"nodes\":[],\"edges\":[]}";
                }
            } else if (path.endsWith("/dashboards")) {
                response = """
                        {"data":[{"fullyQualifiedName":"superset-dataos.2","displayName":"电子处方嵌入验证",
                                  "updatedAt":1787190000000}]}
                        """;
            }
            var bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (var output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        });
        server.start();
        var properties = new OpenMetadataLineageProperties();
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/api/v1");
        service = new LineageAssetService(new OpenMetadataClient(RestClient.builder(), properties), properties);
    }

    @AfterEach
    void stopStub() {
        server.stop(0);
    }

    @Test
    void listsAssetsWithProjectionOnly() {
        var catalog = service.listAssets(null);

        assertThat(catalog.service()).isEqualTo("doris-dataos");
        assertThat(catalog.schema()).isEqualTo("ods_ep");
        assertThat(catalog.assets()).hasSize(2);
        var first = catalog.assets().get(0);
        assertThat(first.name()).isEqualTo("ep_mz_cfzb");
        assertThat(first.columnCount()).isEqualTo(3);
        assertThat(first.updatedAt()).isEqualTo("2026-08-20T01:40:00Z");
        assertThat(lastPath.get()).contains("database=doris-dataos.default.ods_ep");
        assertThat(lastPath.get()).contains("fields=columns");
    }

    @Test
    void returnsAssetDetailWithColumnEvidence() {
        var detail = service.getAsset("doris-dataos.default.ods_ep.ep_mz_cfzb");

        assertThat(detail.name()).isEqualTo("ep_mz_cfzb");
        assertThat(detail.description()).isEqualTo("EP 处方主表");
        assertThat(detail.columns()).hasSize(1);
        assertThat(detail.columns().get(0).dataType()).isEqualTo("varchar(20)");
        assertThat(detail.columns().get(0).description()).isEqualTo("机构代码");
    }

    @Test
    void missingAssetMapsToNotFound() {
        assertThatThrownBy(() -> service.getAsset("doris-dataos.default.ods_ep.missing"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("资产不存在");
    }

    @Test
    void lineageSplitsDirectionAndNormalizesTypes() {
        var lineage = service.getLineage("doris-dataos.default.ods_ep.ep_mz_cfzb");

        assertThat(lineage.root()).isEqualTo("doris-dataos.default.ods_ep.ep_mz_cfzb");
        assertThat(lineage.upstreams()).hasSize(2);
        assertThat(lineage.upstreams()).anySatisfy(node -> {
            assertThat(node.fullyQualifiedName()).isEqualTo("superset-dataos.model.2");
            assertThat(node.type()).isEqualTo("dataModel");
            assertThat(node.displayName()).isEqualTo("superset-dataos.model.2");
        });
        assertThat(lineage.downstreams()).isEmpty();
    }

    @Test
    void summaryCountsTablesColumnsAndDashboards() {
        var summary = service.summary();

        assertThat(summary.service()).isEqualTo("doris-dataos");
        assertThat(summary.tableCount()).isEqualTo(2);
        assertThat(summary.columnCount()).isEqualTo(4);
        assertThat(summary.dashboards()).hasSize(1);
        assertThat(summary.dashboards().get(0).displayName()).isEqualTo("电子处方嵌入验证");
    }

    @Test
    void unreachableOpenMetadataMapsToAdapterUnavailable() {
        var properties = new OpenMetadataLineageProperties();
        properties.setBaseUrl("http://127.0.0.1:1/api/v1");
        var offline = new LineageAssetService(
                new OpenMetadataClient(RestClient.builder(), properties), properties);

        assertThatThrownBy(offline::summary).isInstanceOf(AdapterUnavailableException.class);
    }

    @Test
    void bearerTokenIsAttachedWhenServiceIdentityConfigured() throws IOException {
        var tokenServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var bearer = new AtomicReference<String>();
        tokenServer.createContext("/token", exchange -> {
            var body = "{\"access_token\":\"svc-token\",\"expires_in\":300}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        tokenServer.createContext("/api/v1/dashboards", exchange -> {
            bearer.set(exchange.getRequestHeaders().getFirst("Authorization"));
            var body = "{\"data\":[]}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) {
                output.write(body);
            }
        });
        tokenServer.start();
        try {
            var properties = new OpenMetadataLineageProperties();
            properties.setBaseUrl("http://127.0.0.1:" + tokenServer.getAddress().getPort() + "/api/v1");
            properties.setTokenUri("http://127.0.0.1:" + tokenServer.getAddress().getPort() + "/token");
            properties.setClientId("dataos-om-ingest");
            properties.setClientSecret("secret");
            var client = new OpenMetadataClient(RestClient.builder(), properties);
            assertThat(client.listDashboards("superset-dataos")).isEmpty();
            assertThat(bearer.get()).isEqualTo("Bearer svc-token");
        } finally {
            tokenServer.stop(0);
        }
    }

    @Test
    void responsesNeverCarryConnectionConfig() {
        var catalog = service.listAssets(null);
        var rendered = Map.of("catalog", catalog).toString();

        assertThat(rendered).doesNotContain("password").doesNotContain("connection").doesNotContain("hostPort");
    }
}
