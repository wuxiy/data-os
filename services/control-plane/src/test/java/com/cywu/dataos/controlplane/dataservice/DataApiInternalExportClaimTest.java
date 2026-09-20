package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * G21-2 claim 契约：CAS 认领结果必须以 claimed 布尔回传——
 * 竞争失败方（第二次 PATCH）读到 claimed=false 才会放弃执行；
 * 旧契约丢弃布尔只回投影，失败方把 RUNNING 误读为认领成功造成双执行。
 */
@SpringBootTest(properties = {
        "data-os.auth.mode=DISABLED",
        "data-os.auth.internal-mode=ENFORCED",
        "data-os.auth.issuer-uri=https://id.example.test/realms/data-os",
        "data-os.auth.audience=data-os",
        "data-os.runtime.environment=test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DataApiInternalExportClaimTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DataApiAdminService service;

    @MockBean
    private JwtDecoder jwtDecoder;

    @BeforeEach
    void stubTokenDecoder() {
        var serviceToken = Jwt.withTokenValue("service-token")
                .header("alg", "none")
                .issuer("https://id.example.test/realms/data-os")
                .subject("dataos-data-api")
                .audience(List.of("data-os"))
                .expiresAt(Instant.now().plusSeconds(60))
                .issuedAt(Instant.now().minusSeconds(60))
                .build();
        when(jwtDecoder.decode(anyString())).thenReturn(serviceToken);
    }

    private String publishedServiceCode() {
        var code = "claim-" + UUID.randomUUID().toString().substring(0, 8);
        var request = new CreateDataServiceRequest(
                code, "claim 契约验证服务", "G21 测试",
                """
                SELECT DATE(cf_date) AS stat_date, COUNT(*) AS prescriptions
                FROM ods_ep.ep_mz_cfzb
                WHERE cf_date BETWEEN :start_date AND :end_date
                GROUP BY DATE(cf_date)
                """,
                List.of(
                        new CreateDataServiceRequest.ParameterContract("start_date", "date", true, "开始日期", null, null),
                        new CreateDataServiceRequest.ParameterContract("end_date", "date", true, "结束日期", null, null)),
                List.of(new CreateDataServiceRequest.ColumnContract("stat_date", "date", "统计日期")),
                500, 30, "data-team");
        var definition = service.create(null, request);
        service.publish(definition.id(), null);
        return code;
    }

    @Test
    void claimResultIsReportedForBothWinnerAndLoser() throws Exception {
        var code = publishedServiceCode();
        var export = service.createExport(code, "hash-" + UUID.randomUUID(), null);

        // 第一方：CAS 成功，claimed=true，状态翻到 RUNNING
        mockMvc.perform(patch("/internal/data-api/exports/" + export.id())
                        .header("Authorization", "Bearer service-token")
                        .contentType("application/json")
                        .content("{\"action\":\"claim\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.claimed").value(true))
                .andExpect(jsonPath("$.status").value("RUNNING"));

        // 竞争失败方：claimed=false（仍 200——竞态是正常运维事件，不是错误），
        // 状态保持 RUNNING，失败方依约放弃执行
        mockMvc.perform(patch("/internal/data-api/exports/" + export.id())
                        .header("Authorization", "Bearer service-token")
                        .contentType("application/json")
                        .content("{\"action\":\"claim\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.claimed").value(false))
                .andExpect(jsonPath("$.status").value("RUNNING"));
    }

    @Test
    void finalizeResponseKeepsPlainProjectionWithoutClaimedKey() throws Exception {
        var code = publishedServiceCode();
        var export = service.createExport(code, "hash-" + UUID.randomUUID(), null);
        mockMvc.perform(patch("/internal/data-api/exports/" + export.id())
                        .header("Authorization", "Bearer service-token")
                        .contentType("application/json")
                        .content("{\"action\":\"claim\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(patch("/internal/data-api/exports/" + export.id())
                        .header("Authorization", "Bearer service-token")
                        .contentType("application/json")
                        .content("{\"action\":\"finalize\",\"target\":\"FAILED\",\"error\":\"测试终态\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.claimed").doesNotExist())
                .andExpect(jsonPath("$.status").value("FAILED"));
    }
}
