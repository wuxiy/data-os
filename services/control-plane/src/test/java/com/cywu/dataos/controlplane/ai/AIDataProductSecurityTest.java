package com.cywu.dataos.controlplane.ai;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

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
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
        "data-os.auth.mode=ENFORCED",
        "data-os.auth.issuer-uri=https://id.example.test/realms/data-os",
        "data-os.auth.audience=data-os",
        "data-os.runtime.environment=test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class AIDataProductSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private JwtDecoder jwtDecoder;

    @BeforeEach
    void stubTokenDecoder() {
        var engineerToken = Jwt.withTokenValue("engineer-token")
                .header("alg", "none")
                .issuer("https://id.example.test/realms/data-os")
                .subject("engineer-1")
                .audience(List.of("data-os"))
                .issuedAt(Instant.now().minusSeconds(5))
                .expiresAt(Instant.now().plusSeconds(300))
                .claim("tenant_id", "tenant-a")
                .claim("institution_id", "hospital-a")
                .claim("roles", List.of("data-engineer"))
                .build();
        when(jwtDecoder.decode("engineer-token")).thenReturn(engineerToken);
        var viewerToken = Jwt.withTokenValue("viewer-token")
                .header("alg", "none")
                .issuer("https://id.example.test/realms/data-os")
                .subject("viewer-1")
                .audience(List.of("data-os"))
                .issuedAt(Instant.now().minusSeconds(5))
                .expiresAt(Instant.now().plusSeconds(300))
                .claim("tenant_id", "tenant-b")
                .claim("institution_id", "hospital-b")
                .claim("roles", List.of("viewer"))
                .build();
        when(jwtDecoder.decode("viewer-token")).thenReturn(viewerToken);
    }

    @Test
    void rejectsUnauthenticatedWith401() throws Exception {
        mockMvc.perform(get("/api/v1/ai-data-products"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void viewerCanReadButNotWrite() throws Exception {
        mockMvc.perform(get("/api/v1/ai-data-products")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/ai-data-products")
                        .header("Authorization", "Bearer viewer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"x\",\"type\":\"RAG_CORPUS\",\"owner\":\"o\","
                                + "\"workflow\":\"MEDICAL_RAG\",\"source\":\"s\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void tenantIsolationHidesOtherTenantsProduct() throws Exception {
        var name = "sec-" + UUID.randomUUID();
        String body = mockMvc.perform(post("/api/v1/ai-data-products")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\",\"type\":\"RAG_CORPUS\",\"owner\":\"o\","
                                + "\"workflow\":\"MEDICAL_RAG\",\"source\":\"s\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.lifecycle").value("DRAFT"))
                .andExpect(jsonPath("$.currentVersion").value("v0.1.0"))
                .andReturn().getResponse().getContentAsString();
        var id = com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                .readTree(body).get("id").asText();

        // 他租户 viewer 视角：同一 id 表现为不存在（404），不泄漏存在性
        mockMvc.perform(get("/api/v1/ai-data-products/" + id)
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isNotFound());

        // 本租户视角：详情含版本历史与 build 守护语义
        mockMvc.perform(get("/api/v1/ai-data-products/" + id)
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.product.id").value(id))
                .andExpect(jsonPath("$.versions.length()").value(1));

        mockMvc.perform(post("/api/v1/ai-data-products/" + id + "/build")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("AI_READY_ENGINE_NOT_CONFIGURED"));
    }

    @Test
    void illegalLifecycleTransitionIs409() throws Exception {
        var name = "sec-409-" + UUID.randomUUID();
        String body = mockMvc.perform(post("/api/v1/ai-data-products")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\",\"type\":\"RAG_CORPUS\",\"owner\":\"o\","
                                + "\"workflow\":\"MEDICAL_RAG\",\"source\":\"s\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        var id = com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                .readTree(body).get("id").asText();

        // DRAFT 直接跳 SERVING：状态机拒绝
        mockMvc.perform(post("/api/v1/ai-data-products/" + id + "/lifecycle")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"target\":\"SERVING\"}"))
                .andExpect(status().isConflict());
    }
}
