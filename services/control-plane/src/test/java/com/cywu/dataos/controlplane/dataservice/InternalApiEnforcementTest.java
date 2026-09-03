package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;
import java.util.List;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * S8：全局 DISABLED（dev）+ internal-mode=ENFORCED 时，/internal/** 面仍须
 * 真实服务 token，其余 /api 面维持 permitAll（门户开发态不受影响）。
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
class InternalApiEnforcementTest {

    @Autowired
    private MockMvc mockMvc;

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

    @Test
    void internalRegistryRejectsMissingToken() throws Exception {
        mockMvc.perform(get("/internal/data-api/registry"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void internalRegistryRejectsGarbageToken() throws Exception {
        // 解码失败（无效签名等，BadJwtException 为解码器真实抛型）必须归一为 401。
        when(jwtDecoder.decode(anyString()))
                .thenThrow(new org.springframework.security.oauth2.jwt.BadJwtException("invalid token"));
        mockMvc.perform(get("/internal/data-api/registry").header("Authorization", "Bearer garbage"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void internalRegistryAcceptsServiceToken() throws Exception {
        mockMvc.perform(get("/internal/data-api/registry").header("Authorization", "Bearer service-token"))
                .andExpect(status().isOk());
    }

    @Test
    void internalCallsReachableWithServiceToken() throws Exception {
        // code 无种子数据 → accepted=false，但 200 + 响应体恰证鉴权与路由打通
        // （审计写入语义归 DataApiAdminServiceTest 的业务用例）。
        mockMvc.perform(post("/internal/data-api/calls").header("Authorization", "Bearer service-token")
                        .contentType("application/json")
                        .content("""
                                {"code":"unseeded-code","keyHash":"hash","parametersJson":"{}",
                                 "rowCount":0,"truncated":false,"elapsedMs":1,"statusCode":200,
                                 "idempotencyKey":"idem-internal-1"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accepted").value(false));
    }

    @Test
    void nonInternalApiStaysOpenUnderGlobalDisabled() throws Exception {
        // 全局 DISABLED 语义保持：非 /internal 面无 token 也放行（本端点无角色要求）。
        mockMvc.perform(get("/api/v1/system/status"))
                .andExpect(status().isOk());
    }
}
