package com.cywu.dataos.controlplane.workflow;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import org.junit.jupiter.api.Test;

class ClinicalWorkflowCatalogTest {

    private final ClinicalWorkflowCatalog catalog = new ClinicalWorkflowCatalog();

    @Test
    void exposesTheClinicalContracts() {
        var keys = catalog.list().stream().map(ClinicalWorkflowTemplate::key).toList();
        org.assertj.core.api.Assertions.assertThat(keys)
                .containsExactlyInAnyOrder("LIS_JDBC_TO_DORIS", "LIS_HTTP_TO_DORIS",
                        "EMR_JDBC_TO_DORIS", "SURGERY_JDBC_TO_DORIS", "EP_JDBC_TO_DORIS");
    }

    @Test
    void epContractTargetsDorisOdsAndAcceptsDamengJdbcSource() {
        var template = catalog.require(ClinicalWorkflowCatalog.EP_JDBC_TO_DORIS, 1);
        var sink = (Map<?, ?>) ((List<?>) template.sampleConfig().get("sink")).get(0);

        org.assertj.core.api.Assertions.assertThat(template.systemType()).isEqualTo("EP");
        org.assertj.core.api.Assertions.assertThat(sink.get("database")).isEqualTo("ods_ep");
        org.assertj.core.api.Assertions.assertThat(sink.get("table")).isEqualTo("ep_mz_cfzb");
        org.assertj.core.api.Assertions.assertThat(sink.get("sink.label-prefix"))
                .isEqualTo("dataos_ep_jdbc_to_doris");

        var valid = Map.<String, Object>of(
                "env", Map.of("job.mode", "BATCH"),
                "source", List.of(Map.of("plugin_name", "Jdbc", "credentialRef", "ep-dm-readonly",
                        "url", "jdbc:dm://192.168.17.76:5236?schema=EP_TEST",
                        "driver", "dm.jdbc.driver.DmDriver",
                        "query", "SELECT * FROM EP_MZ_CFZB")),
                "sink", List.of(Map.of("plugin_name", "Doris", "credentialRef", "doris-ods-writer",
                        "fenodes", "172.16.66.8:8030", "database", "ods_ep", "table", "ep_mz_cfzb",
                        "sink.label-prefix", "dataos_ep_jdbc_to_doris", "sink.enable-2pc", false,
                        "schema_save_mode", "CREATE_SCHEMA_WHEN_NOT_EXIST", "data_save_mode", "APPEND_DATA",
                        "doris.config", Map.of("format", "json", "read_json_by_line", "true"))));

        assertDoesNotThrow(() -> catalog.validateConfig(ClinicalWorkflowCatalog.EP_JDBC_TO_DORIS, 1, valid));
    }

    @Test
    void sampleConfigUsesSupportedDorisSaveModeContract() {
        var sink = (List<?>) catalog.require(ClinicalWorkflowCatalog.LIS_JDBC_TO_DORIS, 1)
                .sampleConfig().get("sink");
        var firstSink = (Map<?, ?>) sink.get(0);

        org.assertj.core.api.Assertions.assertThat(firstSink.get("sink.label-prefix"))
                .isEqualTo("dataos_lis_jdbc_to_doris");
        org.assertj.core.api.Assertions.assertThat(firstSink.get("sink.enable-2pc")).isEqualTo(false);
        org.assertj.core.api.Assertions.assertThat(firstSink.get("schema_save_mode"))
                .isEqualTo("CREATE_SCHEMA_WHEN_NOT_EXIST");
        org.assertj.core.api.Assertions.assertThat(firstSink.get("data_save_mode")).isEqualTo("APPEND_DATA");
        org.assertj.core.api.Assertions.assertThat(firstSink.get("doris.config"))
                .isEqualTo(Map.of("format", "json", "read_json_by_line", "true"));
        org.assertj.core.api.Assertions.assertThat(firstSink.containsKey("save_mode")).isFalse();
    }

    @Test
    void requiresConnectorAndCredentialReferences() {
        var valid = Map.<String, Object>of(
                "env", Map.of("job.mode", "BATCH"),
                "source", List.of(Map.of("plugin_name", "Jdbc", "credentialRef", "source-1",
                        "url", "jdbc:postgresql://lis.example/db", "driver", "org.postgresql.Driver", "query", "select 1")),
                "sink", List.of(Map.of("plugin_name", "Doris", "credentialRef", "target-1",
                        "fenodes", "doris-fe.example:8030", "database", "ods_lis", "table", "lab_result",
                        "sink.label-prefix", "dataos_lis_jdbc_to_doris", "sink.enable-2pc", false,
                        "schema_save_mode", "CREATE_SCHEMA_WHEN_NOT_EXIST", "data_save_mode", "APPEND_DATA",
                        "doris.config", Map.of("format", "json", "read_json_by_line", "true"))));

        assertDoesNotThrow(() -> catalog.validateConfig("LIS_JDBC_TO_DORIS", 1, valid));
        assertThrows(InvalidRequestException.class, () -> catalog.validateConfig("LIS_JDBC_TO_DORIS", 1,
                Map.of("source", List.of(Map.of("plugin_name", "Jdbc")),
                        "sink", List.of(Map.of("plugin_name", "Doris")))));
        assertThrows(InvalidRequestException.class, () -> catalog.validateConfig("LIS_JDBC_TO_DORIS", 1,
                Map.of("source", List.of(Map.of("plugin_name", "Jdbc", "credentialRef", "source-1",
                                "url", "jdbc:postgresql://lis.example/db", "driver", "org.postgresql.Driver", "query", "select 1")),
                        "sink", List.of(Map.of("plugin_name", "Doris", "credentialRef", "target-1",
                                "fenodes", "doris-fe.example:8030", "database", "ods_lis", "table", "lab_result")))));
        assertThrows(InvalidRequestException.class, () -> catalog.validateConfig("LIS_JDBC_TO_DORIS", 1,
                Map.of("source", List.of(Map.of("plugin_name", "Jdbc", "credentialRef", "source-1",
                                "url", "jdbc:<replace-with-host>", "driver", "org.postgresql.Driver", "query", "select 1")),
                        "sink", List.of(Map.of("plugin_name", "Doris", "credentialRef", "target-1",
                                "fenodes", "doris-fe.example:8030", "database", "ods_lis", "table", "lab_result")))));
    }

    @Test
    void acceptsTheConfiguredLisHttpContract() {
        var valid = Map.<String, Object>of(
                "env", Map.of("job.mode", "BATCH"),
                "source", List.of(Map.of("plugin_name", "Http", "credentialRef", "source-1",
                        "url", "https://lis.example/api/results", "method", "GET", "format", "JSON")),
                "sink", List.of(Map.of("plugin_name", "Doris", "credentialRef", "target-1",
                        "fenodes", "doris-fe.example:8030", "database", "ods_lis", "table", "lab_result",
                        "sink.label-prefix", "dataos_lis_http_to_doris", "sink.enable-2pc", false,
                        "schema_save_mode", "CREATE_SCHEMA_WHEN_NOT_EXIST", "data_save_mode", "APPEND_DATA",
                        "doris.config", Map.of("format", "json", "read_json_by_line", "true"))));

        assertDoesNotThrow(() -> catalog.validateConfig(ClinicalWorkflowCatalog.LIS_HTTP_TO_DORIS, 1, valid));
    }
}
