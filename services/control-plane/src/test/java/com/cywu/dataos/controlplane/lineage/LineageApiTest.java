package com.cywu.dataos.controlplane.lineage;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 血缘 API 门面：未配置 OpenMetadata 时整链 503（测试 profile 默认未配置），
 * 且中文降级文案稳定（门户据此渲染「待接入」边界而非静态样例）。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class LineageApiTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void assetsReturns503WhenOpenMetadataNotConfigured() throws Exception {
        mockMvc.perform(get("/api/v1/assets")).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(503))
                .andExpect(jsonPath("$.message").value(
                        "血缘服务未配置：请在控制面设置 data-os.openmetadata.base-url 后重启"));
    }

    @Test
    void lineageSummaryReturns503WhenOpenMetadataNotConfigured() throws Exception {
        mockMvc.perform(get("/api/v1/lineage/summary")).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(503));
    }

    @Test
    void assetLineageReturns503WhenOpenMetadataNotConfigured() throws Exception {
        mockMvc.perform(get("/api/v1/assets/doris-dataos.default.ods_ep.ep_mz_cfzb/lineage"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(503));
    }
}
