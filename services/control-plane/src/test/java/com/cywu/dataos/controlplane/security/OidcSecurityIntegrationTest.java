package com.cywu.dataos.controlplane.security;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "data-os.auth.mode=ENFORCED",
        "data-os.auth.issuer-uri=https://id.example.test/realms/data-os",
        "data-os.auth.audience=data-os",
        "data-os.runtime.environment=test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OidcSecurityIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private JwtDecoder jwtDecoder;

    @BeforeEach
    void stubTokenDecoder() throws Exception {
        var token = Jwt.withTokenValue("test-token")
                .header("alg", "none")
                .issuer("https://id.example.test/realms/data-os")
                .subject("user-1")
                .audience(List.of("data-os"))
                .issuedAt(Instant.now().minusSeconds(5))
                .expiresAt(Instant.now().plusSeconds(300))
                .claim("tenant_id", "tenant-a")
                .claim("institution_id", "hospital-a")
                .claim("roles", List.of("viewer"))
                .build();
        when(jwtDecoder.decode("test-token")).thenReturn(token);
        var technicalToken = Jwt.withTokenValue("tech-token")
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
        when(jwtDecoder.decode("tech-token")).thenReturn(technicalToken);
    }

    @Test
    void rejectsUnauthenticatedBusinessApiWith401ProblemJson() throws Exception {
        mockMvc.perform(get("/api/v1/governance/summary"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("UNAUTHENTICATED")));
    }

    @Test
    void rejectsViewerFromGovernanceWriteWith403ProblemJson() throws Exception {
        mockMvc.perform(post("/api/v1/governance/sla/scan")
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("FORBIDDEN")));
    }

    @Test
    void rejectsViewerFromTechnicalComponentWorkspaceWith403() throws Exception {
        mockMvc.perform(get("/api/v1/platform-operations")
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isForbidden())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("FORBIDDEN")));
    }

    @Test
    void allowsTechnicalRoleToReadComponentWorkspaceWithoutReturningSecrets() throws Exception {
        mockMvc.perform(get("/api/v1/platform-operations")
                        .header("Authorization", "Bearer tech-token"))
                .andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("technicalAccess")))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("token"))));
    }
}
