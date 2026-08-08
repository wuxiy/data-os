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
    void exposesTheThreeClinicalContracts() {
        var keys = catalog.list().stream().map(ClinicalWorkflowTemplate::key).toList();
        org.assertj.core.api.Assertions.assertThat(keys)
                .containsExactlyInAnyOrder("LIS_JDBC_TO_DORIS", "EMR_JDBC_TO_DORIS", "SURGERY_JDBC_TO_DORIS");
    }

    @Test
    void requiresConnectorAndCredentialReferences() {
        var valid = Map.<String, Object>of(
                "env", Map.of("job.mode", "BATCH"),
                "source", List.of(Map.of("plugin_name", "Jdbc", "credentialRef", "source-1",
                        "url", "jdbc:postgresql://lis.example/db", "driver", "org.postgresql.Driver", "query", "select 1")),
                "sink", List.of(Map.of("plugin_name", "Doris", "credentialRef", "target-1",
                        "fenodes", "doris-fe.example:8030", "database", "ods_lis", "table", "lab_result")));

        assertDoesNotThrow(() -> catalog.validateConfig("LIS_JDBC_TO_DORIS", 1, valid));
        assertThrows(InvalidRequestException.class, () -> catalog.validateConfig("LIS_JDBC_TO_DORIS", 1,
                Map.of("source", List.of(Map.of("plugin_name", "Jdbc")),
                        "sink", List.of(Map.of("plugin_name", "Doris")))));
        assertThrows(InvalidRequestException.class, () -> catalog.validateConfig("LIS_JDBC_TO_DORIS", 1,
                Map.of("source", List.of(Map.of("plugin_name", "Jdbc", "credentialRef", "source-1",
                                "url", "jdbc:<replace-with-host>", "driver", "org.postgresql.Driver", "query", "select 1")),
                        "sink", List.of(Map.of("plugin_name", "Doris", "credentialRef", "target-1",
                                "fenodes", "doris-fe.example:8030", "database", "ods_lis", "table", "lab_result")))));
    }
}
