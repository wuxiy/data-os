package com.cywu.dataos.controlplane.assistant;

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
 * 问数三级权限与租户边界（G26）：三接口全部经认证基线（匿名 401）；
 * 越租户参数 403；跨租户问题不可见（tenant-b 只见自己租户的问题）；
 * 审计行跨租户 404。执行面 MockBean（本测试不触达执行）。
 */
@SpringBootTest(properties = {
        "data-os.auth.mode=ENFORCED",
        "data-os.auth.issuer-uri=https://id.example.test/realms/data-os",
        "data-os.auth.audience=data-os",
        "data-os.runtime.environment=test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AssistantSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AssistantRepository repository;

    @MockBean
    private JwtDecoder jwtDecoder;

    @MockBean
    private AssistantDataApiClient dataApi;

    @BeforeEach
    void stubTokenDecoder() {
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

    private String seededQuestionInTenantA() {
        var id = java.util.UUID.randomUUID().toString();
        var now = Instant.now();
        // 每次唯一 code（H2 上下文跨用例共享，租户内 code 唯一约束）
        var code = "assistant-sec-" + java.util.UUID.randomUUID().toString().substring(0, 8);
        repository.insertQuestion(new AssistantQuestion(
                id, "tenant-a", code,
                "安全测试问题",
                List.of("安全别名"), "[{\"name\":\"start_date\",\"type\":\"date\",\"required\":true}]",
                "assistant-sec-service", "回答 {start_date}", "PUBLISHED", "tester", now, now));
        return code;
    }

    @Test
    void anonymousIsRejectedWhileAnyAuthenticatedRoleCanAsk() throws Exception {
        mockMvc.perform(get("/api/v1/assistant/questions"))
                .andExpect(status().isUnauthorized());
        // tenant-b 无种子（断言不受其他用例在 tenant-a 播种影响）
        mockMvc.perform(get("/api/v1/assistant/questions")
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
    }

    @Test
    void crossTenantQuestionsAreInvisibleAndParamsRejected() throws Exception {
        seededQuestionInTenantA();
        // tenant-b 用户看不到 tenant-a 的问题（也无 default 租户种子）
        mockMvc.perform(get("/api/v1/assistant/questions")
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
        // 提问在 tenant-b 无匹配 → 拒答（不是泄漏存在性）
        mockMvc.perform(post("/api/v1/assistant/query")
                        .header("Authorization", "Bearer engineer-b-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"安全测试问题\",\"parameters\":{\"start_date\":\"2026-09-01\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.answered").value(false))
                .andExpect(jsonPath("$.outcome").value("REFUSED_NO_MATCH"));
        // 越租户参数（tenant-b 声明访问 tenant-a 的种子范围）→ 403
        mockMvc.perform(get("/api/v1/assistant/questions")
                        .param("tenantId", "tenant-b")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isForbidden());
        // 跨租户反馈审计行 → 404（不存在同观）
        mockMvc.perform(post("/api/v1/assistant/feedback")
                        .header("Authorization", "Bearer engineer-b-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"auditId\":\"00000000-0000-0000-0000-000000000000\",\"rating\":\"helpful\"}"))
                .andExpect(status().isNotFound());
    }

    @Test
    void tenantAUserSeesOwnQuestionsAndQueryRefusesWithoutExecutorConfig() throws Exception {
        seededQuestionInTenantA();
        mockMvc.perform(get("/api/v1/assistant/questions")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.questions[0].serviceCode").value("assistant-sec-service"));
        // 执行面未配置（MockBean configured()=false）→ 诚实拒答而非演示答案
        mockMvc.perform(post("/api/v1/assistant/query")
                        .header("Authorization", "Bearer viewer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"安全测试问题\",\"parameters\":{\"start_date\":\"2026-09-01\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.answered").value(false))
                .andExpect(jsonPath("$.outcome").value("REFUSED_UNAVAILABLE"));
    }

    @Test
    void governanceSurfaceEnforcesRoleMatrix() throws Exception {
        stub("governance-token", "gov-a", "tenant-a", List.of("data-governance"));
        stub("engineer-token", "engineer-a", "tenant-a", List.of("data-engineer"));
        stub("admin-token", "admin-a", "tenant-a", List.of("tenant-admin"));

        // 治理列表：viewer 403；工程/治理/管理员可见
        mockMvc.perform(get("/api/v1/assistant/admin/questions")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/assistant/admin/questions")
                        .header("Authorization", "Bearer governance-token"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/assistant/admin/questions")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isOk());

        var code = "gov-sec-" + java.util.UUID.randomUUID().toString().substring(0, 8);
        var body = "{\"code\":\"" + code + "\",\"question\":\"治理安全问题\",\"aliases\":[],"
                + "\"paramSchema\":[],\"serviceCode\":\"assistant-sec-service\",\"answerTemplate\":\"\"}";

        // 建/试运行：工程师可以，治理角色 403（治理动作之外只读）
        mockMvc.perform(post("/api/v1/assistant/admin/questions")
                        .header("Authorization", "Bearer governance-token")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/assistant/admin/questions")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"));

        // 发布：工程师 403（治理动作），管理员过关（业务 409 属正常语义——未试运行）
        mockMvc.perform(post("/api/v1/assistant/admin/questions/" + code + "/publish")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/assistant/admin/questions/" + code + "/publish")
                        .header("Authorization", "Bearer admin-token"))
                .andExpect(status().isConflict());
    }

    @Test
    void crossTenantGovernanceIsInvisible() throws Exception {
        var tenantACode = seededQuestionInTenantA();
        // tenant-b 工程师看 tenant-a 的问题：列表 0（不可见）
        mockMvc.perform(get("/api/v1/assistant/admin/questions")
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));
        // tenant-b 工程师按 tenant-a 的 code 操作（试探）→ 404 不泄漏存在性
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/v1/assistant/admin/questions/" + tenantACode)
                        .header("Authorization", "Bearer engineer-b-token"))
                .andExpect(status().isNotFound());
    }
}
