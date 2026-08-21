package com.cywu.dataos.controlplane.quality;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

class QualityAssetTestsServiceTest {

    private final JdbcTemplate jdbc = Mockito.mock(JdbcTemplate.class);

    @Test
    void resolvesDatasetByFqnSegmentsAndConfiguredMapping() {
        var properties = new QualityAssetProperties();
        properties.setDatasetTables(java.util.Map.of(
                "asset-ep-prescription-edge", List.of(
                        "doris-dataos.default.ods_ep.ep_mz_cfzb_edge",
                        "doris-dataos.default.ods_ep.ep_mz_ypcfmx_edge")));
        var service = new QualityAssetTestsService(jdbc, properties);

        service.listTests("doris-dataos.default.ods_ep.ep_mz_cfzb_edge");

        // 两个 dataset 都要查（库.表 段匹配 + 逻辑资产配置映射）。
        verify(jdbc).query(anyString(), Mockito.any(RowCallbackHandler.class), eq("ods_ep.ep_mz_cfzb_edge"));
        verify(jdbc).query(anyString(), Mockito.any(RowCallbackHandler.class), eq("asset-ep-prescription-edge"));
    }

    @Test
    void returnsEmptyWhenRegistryHasNoRulesForDataset() {
        var service = new QualityAssetTestsService(jdbc, new QualityAssetProperties());

        // 无配置映射时仍按「库.表」段匹配查询一次（registry 无此 dataset 即空）。
        assertThat(service.listTests("doris-dataos.default.dataos_mpi.mpi_source_identity")).isEmpty();

        verify(jdbc).query(anyString(), Mockito.any(RowCallbackHandler.class), eq("dataos_mpi.mpi_source_identity"));
    }
}
