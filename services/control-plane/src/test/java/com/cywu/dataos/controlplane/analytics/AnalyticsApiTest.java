package com.cywu.dataos.controlplane.analytics;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 嵌入式分析 API 门面：未配置 Superset 时 503（测试 profile 默认未配置），
 * 中文降级文案稳定（门户据此渲染「待接入」边界）。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AnalyticsApiTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void guestTokenReturns503WhenSupersetNotConfigured() throws Exception {
        mockMvc.perform(post("/api/v1/analytics/guest-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"dashboardId\":\"2\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value(503))
                .andExpect(jsonPath("$.message").value(
                        "分析服务未配置：请在控制面设置 data-os.analytics.superset.base-url 后重启"));
    }
}
