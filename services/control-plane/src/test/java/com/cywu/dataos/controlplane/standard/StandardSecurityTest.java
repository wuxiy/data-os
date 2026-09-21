package com.cywu.dataos.controlplane.standard;

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
 * 数据标准三级权限与租户边界（G22）：读=六角色；起草/提交=工程师；
 * 发布/停用/同步重试=管理员；跨租户读取不泄漏存在性、越租户参数 403。
 */
@SpringBootTest(properties = {
        "data-os.auth.mode=ENFORCED",
        "data-os.auth.issuer-uri=https://id.example.test/realms/data-os",
        "data-os.auth.audience=data-os",
        "data-os.runtime.environment=test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class StandardSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private StandardAdminService service;

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

    private String createBody(String code) {
        return """
                {"code":"%s","name":"就诊人类别","description":"d","owner":"data-team",
                 "elements":[
                   {"code":"patient_class","name":"就诊人类别","dataType":"CODE","required":true,
                    "definition":"门诊/急诊/体检","sensitivity":"NORMAL","assetRef":"",
                    "values":[{"code":"OPD","displayName":"门诊"},{"code":"ER","displayName":"急诊"}]},
                   {"code":"visit_no","name":"就诊号","dataType":"STRING","required":true,
                    "definition":"院内唯一","sensitivity":"NORMAL","assetRef":"","values":[]}]}
                """.formatted(code);
    }

    private String createStandardAsEngineer(String code) throws Exception {
        var body = mockMvc.perform(post("/api/v1/data-standards")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody(code)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                .readTree(body).path("version").path("id").asText();
    }

    @Test
    void viewerReadsButCannotWrite() throws Exception {
        var versionId = createStandardAsEngineer("sec-" + java.util.UUID.randomUUID().toString().substring(0, 8));
        mockMvc.perform(get("/api/v1/data-standards")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray());
        mockMvc.perform(post("/api/v1/data-standards")
                        .header("Authorization", "Bearer viewer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody("sec-v-" + java.util.UUID.randomUUID().toString().substring(0, 6))))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/data-standard-versions/" + versionId + "/submit")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isForbidden());
    }

    @Test
    void publishIsAdminOnlyWhileDraftingIsEngineerAllowed() throws Exception {
        var versionId = createStandardAsEngineer("sec-" + java.util.UUID.randomUUID().toString().substring(0, 8));
        // 工程师可提交评审
        mockMvc.perform(post("/api/v1/data-standard-versions/" + versionId + "/submit")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isOk());
        // 越级发布：工程师 403（网关层即拒），管理员 200
        mockMvc.perform(post("/api/v1/data-standard-versions/" + versionId + "/publish")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/data-standard-versions/" + versionId + "/publish")
                        .header("Authorization", "Bearer admin-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.version.syncStatus").value("SYNC_PENDING"));
        // 停用同权限
        mockMvc.perform(post("/api/v1/data-standard-versions/" + versionId + "/deprecate")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isForbidden());
    }

    @Test
    void crossTenantIsInvisibleAndTenantParamIsRejected() throws Exception {
        var versionId = createStandardAsEngineer("sec-" + java.util.UUID.randomUUID().toString().substring(0, 8));

        // tenant-b 工程师看不到 tenant-a 的标准（列表计数 0 + 直取 404）
        mockMvc.perform(get("/api/v1/data-standards")
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
        // 越租户参数：TenantScope 拒绝（403），不泄漏存在性
        mockMvc.perform(get("/api/v1/data-standards")
                        .param("tenantId", "tenant-b")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isForbidden());
        assertThatStandardHiddenFromTenantB(versionId);
    }

    private void assertThatStandardHiddenFromTenantB(String versionId) throws Exception {
        // 版本影响面直接以 tenant-b 身份取 → 404（不存在同观）
        mockMvc.perform(get("/api/v1/data-standard-versions/" + versionId + "/impact")
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isNotFound());
    }
}
