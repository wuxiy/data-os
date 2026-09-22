package com.cywu.dataos.controlplane.delivery;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 交付中心三级权限与租户边界（G25）：读（含证据包下载）=六角色；
 * 建项/交付项/快照/启动/提交=工程师及以上；验收/归档=管理员；
 * 跨租户读取不泄漏存在性、越租户参数 403。
 */
@SpringBootTest(properties = {
        "data-os.auth.mode=ENFORCED",
        "data-os.auth.issuer-uri=https://id.example.test/realms/data-os",
        "data-os.auth.audience=data-os",
        "data-os.runtime.environment=test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DeliverySecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DeliveryAdminService service;

    @MockBean
    private JwtDecoder jwtDecoder;

    @BeforeEach
    void stubTokenDecoder() {
        stub("engineer-token", "engineer-a", "tenant-a", List.of("data-engineer"));
        stub("admin-token", "admin-a", "tenant-a", List.of("tenant-admin"));
        stub("viewer-token", "viewer-a", "tenant-a", List.of("viewer"));
        stub("engineer-b-token", "engineer-b", "tenant-b", List.of("data-engineer"));
    }

    private void stub(String token, String subject, String tenant, List<String> roles) {
        var jwt = Jwt.withTokenValue(token)
                .header("alg", "none")
                .issuer("https://id.example.test/realms/data-os")
                .subject(subject)
                .audience(List.of("data-os"))
                .issuedAt(Instant.now().minusSeconds(60))
                .expiresAt(Instant.now().plusSeconds(600))
                .claim("tenant_id", tenant)
                .claim("institution_id", "hospital-" + tenant)
                .claim("roles", roles)
                .build();
        when(jwtDecoder.decode(token)).thenReturn(jwt);
    }

    private String createProjectAsEngineer(String code) throws Exception {
        var body = mockMvc.perform(post("/api/v1/deliveries")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"%s\",\"name\":\"门诊处方交付\",\"scope\":\"s\",\"owner\":\"张三\"}"
                                .formatted(code)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                .readTree(body).path("project").path("id").asText();
    }

    @Test
    void viewerReadsButCannotWrite() throws Exception {
        mockMvc.perform(get("/api/v1/deliveries")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.projects").isArray());
        mockMvc.perform(post("/api/v1/deliveries")
                        .header("Authorization", "Bearer viewer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"sec-v\",\"name\":\"x\"}"))
                .andExpect(status().isForbidden());
        // 证据包下载对 viewer 开放（角色过关后才有 404 业务结果）
        mockMvc.perform(get("/api/v1/deliveries/none/evidence.zip")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isNotFound());
    }

    @Test
    void acceptanceAndArchivalAreAdminOnlyWhileDeliveryWorkIsEngineerAllowed() throws Exception {
        var projectId = createProjectAsEngineer("sec-" + java.util.UUID.randomUUID().toString().substring(0, 8));
        // 工程师可启动（带幂等键）
        mockMvc.perform(post("/api/v1/deliveries/" + projectId + "/start")
                        .header("Authorization", "Bearer engineer-token")
                        .header("Idempotency-Key", "sec-start"))
                .andExpect(status().isBadRequest()); // 交付项为空：角色已过，业务校验生效
        // 验收/归档：工程师 403（网关层即拒），管理员角色过关（业务 409/400 属正常语义）
        mockMvc.perform(post("/api/v1/deliveries/" + projectId + "/accept")
                        .header("Authorization", "Bearer engineer-token")
                        .header("Idempotency-Key", "sec-accept"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/deliveries/" + projectId + "/archive")
                        .header("Authorization", "Bearer engineer-token")
                        .header("Idempotency-Key", "sec-archive"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/deliveries/" + projectId + "/accept")
                        .header("Authorization", "Bearer admin-token")
                        .header("Idempotency-Key", "sec-accept-admin"))
                .andExpect(status().isConflict()); // 非 READY：角色已过
        // 幂等键缺失在角色之后也必须拦截（400）
        mockMvc.perform(post("/api/v1/deliveries/" + projectId + "/snapshot")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void crossTenantIsInvisibleAndTenantParamIsRejected() throws Exception {
        var projectId = createProjectAsEngineer("sec-" + java.util.UUID.randomUUID().toString().substring(0, 8));
        // tenant-b 工程师看不到 tenant-a 的项目（列表计数 0 + 直取 404）
        mockMvc.perform(get("/api/v1/deliveries")
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(get("/api/v1/deliveries/" + projectId)
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/deliveries/" + projectId + "/evidence.zip")
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isNotFound());
        // 越租户参数：TenantScope 拒绝（403），不泄漏存在性
        mockMvc.perform(get("/api/v1/deliveries")
                        .param("tenantId", "tenant-b")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isForbidden());
    }
}
