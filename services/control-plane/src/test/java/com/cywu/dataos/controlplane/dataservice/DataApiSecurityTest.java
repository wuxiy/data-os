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

@SpringBootTest(properties = {
        "data-os.auth.mode=ENFORCED",
        "data-os.auth.issuer-uri=https://id.example.test/realms/data-os",
        "data-os.auth.audience=data-os",
        "data-os.runtime.environment=test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class DataApiSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private DataApiAdminService service;

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
                .claim("tenant_id", "tenant-a")
                .claim("institution_id", "hospital-a")
                .claim("roles", List.of("viewer"))
                .build();
        when(jwtDecoder.decode("viewer-token")).thenReturn(viewerToken);
        var serviceToken = Jwt.withTokenValue("data-api-service-token")
                .header("alg", "none")
                .issuer("https://id.example.test/realms/data-os")
                .subject("service-data-api")
                .audience(List.of("data-os"))
                .issuedAt(Instant.now().minusSeconds(5))
                .expiresAt(Instant.now().plusSeconds(300))
                .build();
        when(jwtDecoder.decode("data-api-service-token")).thenReturn(serviceToken);
    }

    private String createBody() {
        return """
                {"code":"sec-%s","name":"汇总","description":"d",
                 "sqlTemplate":"SELECT DATE(cf_date) AS stat_date FROM ods_ep.ep_mz_cfzb WHERE cf_date >= :start_date",
                 "parameters":[{"name":"start_date","type":"date","required":true}],
                 "columns":[{"name":"stat_date","type":"date"}],
                 "maxRows":100,"timeoutSeconds":30,"owner":"data-team"}
                """.formatted(UUID.randomUUID().toString().substring(0, 8));
    }

    @Test
    void rejectsUnauthenticatedWith401() throws Exception {
        mockMvc.perform(get("/api/v1/data-services"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/internal/data-api/registry"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void viewerCanReadButNotWrite() throws Exception {
        mockMvc.perform(get("/api/v1/data-services")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/data-services")
                        .header("Authorization", "Bearer viewer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody()))
                .andExpect(status().isForbidden());
    }

    @Test
    void engineerCreatesPublishesAndIssuesKey() throws Exception {
        String body = mockMvc.perform(post("/api/v1/data-services")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andReturn().getResponse().getContentAsString();
        var id = com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                .readTree(body).get("id").asText();

        mockMvc.perform(post("/api/v1/data-services/" + id + "/publish")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"));

        mockMvc.perform(post("/api/v1/data-services/" + id + "/keys")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"callerName\":\"合作方\",\"dailyQuota\":50}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.apiKey").isNotEmpty());

        mockMvc.perform(get("/api/v1/data-services/" + id + "/calls")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/internal/data-api/registry")
                        .header("Authorization", "Bearer data-api-service-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.services").isArray());
    }

    @Test
    void illegalTransitionIs409() throws Exception {
        String body = mockMvc.perform(post("/api/v1/data-services")
                        .header("Authorization", "Bearer engineer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody()))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        var id = com.fasterxml.jackson.databind.json.JsonMapper.builder().build()
                .readTree(body).get("id").asText();

        // DRAFT 直接 DEPRECATED：状态机拒绝
        mockMvc.perform(post("/api/v1/data-services/" + id + "/deprecate")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isConflict());
    }
}
