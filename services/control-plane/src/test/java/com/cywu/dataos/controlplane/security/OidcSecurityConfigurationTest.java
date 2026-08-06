package com.cywu.dataos.controlplane.security;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.Map;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

class OidcSecurityConfigurationTest {

    private static final String ISSUER = "https://id.example.test/realms/data-os";

    @AfterEach
    void clearAuthentication() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void validatesAudienceAndIssuerClaims() {
        var token = token(Instant.now().minusSeconds(5), Instant.now().plusSeconds(60),
                List.of("data-os"), ISSUER);
        var validAudience = new OidcSecurityConfiguration.AudienceValidator("data-os").validate(token);
        var invalidAudience = new OidcSecurityConfiguration.AudienceValidator("other-api").validate(token);
        var validIssuer = new JwtIssuerValidator(ISSUER).validate(token);
        var invalidIssuer = new JwtIssuerValidator("https://other.example.test").validate(token);

        assertFalse(validAudience.hasErrors());
        assertTrue(invalidAudience.hasErrors());
        assertFalse(validIssuer.hasErrors());
        assertTrue(invalidIssuer.hasErrors());
    }

    @Test
    void allowsOnlyConfiguredClockSkew() {
        var withinSkew = token(Instant.now().minusSeconds(70), Instant.now().minusSeconds(10),
                List.of("data-os"), ISSUER);
        var beyondSkew = token(Instant.now().minusSeconds(130), Instant.now().minusSeconds(70),
                List.of("data-os"), ISSUER);
        var validator = new JwtTimestampValidator(java.time.Duration.ofSeconds(60));

        assertFalse(validator.validate(withinSkew).hasErrors());
        assertTrue(validator.validate(beyondSkew).hasErrors());
    }

    @Test
    void rejectsCrossTenantRequestAsForbidden() {
        var properties = new AuthProperties();
        properties.setMode("ENFORCED");
        var jwt = token(Instant.now().minusSeconds(5), Instant.now().plusSeconds(60),
                List.of("data-os"), ISSUER);
        jwt = Jwt.withTokenValue(jwt.getTokenValue())
                .header("alg", "none")
                .issuer(ISSUER)
                .subject("user-1")
                .audience(List.of("data-os"))
                .issuedAt(jwt.getIssuedAt())
                .expiresAt(jwt.getExpiresAt())
                .claim("tenant_id", "tenant-a")
                .claim("institution_id", "hospital-a")
                .build();
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthenticationToken(jwt,
                List.of(new SimpleGrantedAuthority("ROLE_tenant-admin"))));

        var scope = new TenantScope(properties);
        assertThrows(AccessDeniedException.class, () -> scope.resolve("tenant-b", "hospital-a"));
        assertThrows(AccessDeniedException.class, () -> scope.resolve("tenant-a", "hospital-b"));
    }

    @Test
    void securityHandlersReturnProblemJsonWithoutTokenDetails() throws Exception {
        var configuration = new OidcSecurityConfiguration();
        var request = new MockHttpServletRequest();
        var unauthorized = new MockHttpServletResponse();
        configuration.jsonAuthenticationEntryPoint().commence(request, unauthorized, null);
        assertTrue(unauthorized.getContentType().startsWith("application/problem+json"));
        assertTrue(unauthorized.getContentAsString().contains("\"code\":\"UNAUTHENTICATED\""));

        var forbidden = new MockHttpServletResponse();
        configuration.jsonAccessDeniedHandler().handle(request, forbidden, null);
        assertTrue(forbidden.getContentType().startsWith("application/problem+json"));
        assertTrue(forbidden.getContentAsString().contains("\"status\":403"));
        assertFalse(forbidden.getContentAsString().contains("token"));
    }

    @Test
    void onlyMapsResourceRolesFromConfiguredApiClient() {
        var otherClientToken = token(Instant.now().minusSeconds(5), Instant.now().plusSeconds(60),
                List.of("data-os"), ISSUER);
        otherClientToken = Jwt.withTokenValue(otherClientToken.getTokenValue())
                .header("alg", "none")
                .issuer(ISSUER)
                .subject("user-1")
                .audience(List.of("data-os"))
                .issuedAt(otherClientToken.getIssuedAt())
                .expiresAt(otherClientToken.getExpiresAt())
                .claim("resource_access", Map.of("other-client", Map.of("roles", List.of("platform-admin"))))
                .build();

        var otherClientAuthorities = new OidcSecurityConfiguration()
                .authorities(otherClientToken, "data-os");
        assertFalse(otherClientAuthorities.contains(new SimpleGrantedAuthority("ROLE_platform-admin")));

        var apiClientToken = Jwt.withTokenValue(otherClientToken.getTokenValue())
                .header("alg", "none")
                .issuer(ISSUER)
                .subject("user-1")
                .audience(List.of("data-os"))
                .issuedAt(otherClientToken.getIssuedAt())
                .expiresAt(otherClientToken.getExpiresAt())
                .claim("resource_access", Map.of("data-os", Map.of("roles", List.of("platform-admin"))))
                .build();
        var apiClientAuthorities = new OidcSecurityConfiguration().authorities(apiClientToken, "data-os");
        assertTrue(apiClientAuthorities.contains(new SimpleGrantedAuthority("ROLE_platform-admin")));
    }

    private Jwt token(Instant issuedAt, Instant expiresAt, List<String> audience, String issuer) {
        return Jwt.withTokenValue("unit-test-token")
                .header("alg", "none")
                .issuer(issuer)
                .subject("user-1")
                .audience(audience)
                .issuedAt(issuedAt)
                .expiresAt(expiresAt)
                .build();
    }
}
