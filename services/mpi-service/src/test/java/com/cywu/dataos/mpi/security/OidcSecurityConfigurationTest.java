package com.cywu.dataos.mpi.security;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * JWKS 直连旁路（G2G B 组收口，S7 同款）：网关自签 HTTPS issuer 时 discovery
 * 取 JWKS 会失败——jwk-set-uri 配置后 decoder 须不触网络即可构造；空值仍走
 * issuer discovery 的旧路径与既有守卫。
 */
class OidcSecurityConfigurationTest {

    private final OidcSecurityConfiguration configuration = new OidcSecurityConfiguration();

    private AuthProperties properties(String issuer, String jwkSetUri) {
        var properties = new AuthProperties();
        properties.setIssuerUri(issuer);
        properties.setJwkSetUri(jwkSetUri);
        return properties;
    }

    @Test
    void jwkSetUriBuildsDecoderWithoutIssuerDiscovery() {
        var decoder = configuration.jwtDecoder(properties(
                "https://gateway.invalid:8443/auth/realms/data-platform",
                "http://keycloak:8080/auth/realms/data-platform/protocol/openid-connect/certs"));
        assertThat(decoder).isInstanceOf(NimbusJwtDecoder.class);
    }

    @Test
    void blankJwkSetUriKeepsIssuerGuards() {
        // discovery 路径不可在单测触网，这里只验证守卫先于 decoder 构造生效。
        assertThatThrownBy(() -> configuration.jwtDecoder(properties("", "")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DATAOS_MPI_OIDC_ISSUER_URI");
    }

    @Test
    void jwkSetUriGetterNormalizesNull() {
        var properties = new AuthProperties();
        properties.setJwkSetUri(null);
        assertThat(properties.getJwkSetUri()).isEmpty();
    }

    @Test
    void audienceValidatorRejectsForeignAudience() {
        var validator = new OidcSecurityConfiguration.AudienceValidator("data-os-mpi");
        var foreign = Jwt.withTokenValue("t")
                .header("alg", "RS256")
                .claim("aud", List.of("account"))
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60))
                .build();
        assertThat(validator.validate(foreign).hasErrors()).isTrue();
        var matching = Jwt.withTokenValue("t")
                .header("alg", "RS256")
                .claim("aud", List.of("data-os-mpi"))
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(60))
                .build();
        assertThat(validator.validate(matching).hasErrors()).isFalse();
    }
}
