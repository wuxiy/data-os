package com.cywu.dataos.controlplane.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import com.cywu.dataos.controlplane.credential.CredentialProperties;
import com.cywu.dataos.controlplane.source.SourceNetworkProperties;
import jakarta.servlet.http.HttpServletResponse;

@Configuration
@EnableMethodSecurity
@EnableConfigurationProperties({AuthProperties.class, CredentialProperties.class, SourceNetworkProperties.class})
public class OidcSecurityConfiguration {

    @Bean
    @ConditionalOnProperty(name = "data-os.auth.mode", havingValue = "ENFORCED")
    JwtDecoder jwtDecoder(AuthProperties properties) {
        if (properties.getIssuerUri() == null || properties.getIssuerUri().isBlank()) {
            throw new IllegalStateException("生产认证必须配置 DATAOS_OIDC_ISSUER_URI");
        }
        if (properties.getAudience() == null || properties.getAudience().isBlank()) {
            throw new IllegalStateException("生产认证必须配置 DATAOS_OIDC_AUDIENCE");
        }
        if (properties.getClockSkewSeconds() < 0 || properties.getClockSkewSeconds() > 300) {
            throw new IllegalStateException("DATAOS_OIDC_CLOCK_SKEW_SECONDS 必须在 0 到 300 秒之间");
        }
        var decoder = JwtDecoders.fromIssuerLocation(properties.getIssuerUri().trim());
        if (decoder instanceof NimbusJwtDecoder nimbus) {
            var issuer = properties.getIssuerUri().trim();
            var timestamp = new JwtTimestampValidator(Duration.ofSeconds(properties.getClockSkewSeconds()));
            nimbus.setJwtValidator(new org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator<>(
                    new JwtIssuerValidator(issuer), timestamp,
                    new AudienceValidator(properties.getAudience().trim())));
        }
        return decoder;
    }

    @Bean
    @ConditionalOnProperty(name = "data-os.auth.mode", havingValue = "ENFORCED")
    SecurityFilterChain oidcSecurity(HttpSecurity http, JwtDecoder decoder,
                                      Converter<Jwt, ? extends org.springframework.security.authentication.AbstractAuthenticationToken> jwtConverter)
            throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health/**", "/actuator/prometheus", "/healthz", "/error").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/auth/me").authenticated()
                        .requestMatchers(HttpMethod.GET, "/api/v1/system/status").authenticated()
                        .requestMatchers(HttpMethod.GET, "/api/v1/platform-operations/**")
                        .hasAnyRole("platform-admin", "platform-operator", "data-engineer")
                        .requestMatchers(HttpMethod.POST, "/api/v1/governance/notifications/deliver")
                        .hasRole("platform-admin")
                        .requestMatchers(HttpMethod.GET, "/api/v1/credentials/**")
                        .hasAnyRole("platform-admin", "tenant-admin", "data-engineer", "data-governance")
                        .requestMatchers("/api/v1/credentials/**")
                        .hasAnyRole("platform-admin", "tenant-admin", "data-engineer")
                        .requestMatchers(HttpMethod.GET, "/api/v1/governance/**")
                        .hasAnyRole("platform-admin", "tenant-admin", "data-governance", "data-analyst", "viewer")
                        .requestMatchers("/api/v1/governance/**")
                        .hasAnyRole("platform-admin", "tenant-admin", "data-governance")
                        .requestMatchers(HttpMethod.GET, "/api/v1/sources/**", "/api/v1/jobs/**")
                        .hasAnyRole("platform-admin", "tenant-admin", "data-engineer", "data-governance", "data-analyst", "viewer")
                        .requestMatchers(HttpMethod.GET, "/api/v1/assets/**", "/api/v1/lineage/**")
                        .hasAnyRole("platform-admin", "tenant-admin", "data-engineer", "data-governance", "data-analyst", "viewer")
                        .requestMatchers(HttpMethod.POST, "/api/v1/analytics/guest-token")
                        .hasAnyRole("platform-admin", "tenant-admin", "data-engineer", "data-governance", "data-analyst", "viewer")
                        .requestMatchers("/api/v1/sources/**", "/api/v1/jobs/**")
                        .hasAnyRole("platform-admin", "tenant-admin", "data-engineer")
                        .requestMatchers("/api/**").authenticated()
                        .anyRequest().permitAll())
                .oauth2ResourceServer(oauth -> oauth
                        .authenticationEntryPoint(jsonAuthenticationEntryPoint())
                        .accessDeniedHandler(jsonAccessDeniedHandler())
                        .jwt(jwt -> jwt.decoder(decoder).jwtAuthenticationConverter(jwtConverter)))
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(jsonAuthenticationEntryPoint())
                        .accessDeniedHandler(jsonAccessDeniedHandler()))
                .headers(headers -> headers
                        .contentTypeOptions(content -> {})
                        .frameOptions(frame -> frame.deny())
                        .httpStrictTransportSecurity(hsts -> hsts.includeSubDomains(true).maxAgeInSeconds(31536000)))
                .anonymous(anonymous -> anonymous.disable());
        return http.build();
    }

    @Bean
    @ConditionalOnProperty(name = "data-os.auth.mode", havingValue = "DISABLED", matchIfMissing = true)
    SecurityFilterChain localDevelopmentSecurity(HttpSecurity http) throws Exception {
        http
                .csrf(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
                .headers(headers -> headers
                        .contentTypeOptions(content -> {})
                        .frameOptions(frame -> frame.deny()));
        return http.build();
    }

    @Bean
    @ConditionalOnProperty(name = "data-os.auth.mode", havingValue = "ENFORCED")
    Converter<Jwt, ? extends org.springframework.security.authentication.AbstractAuthenticationToken> jwtAuthenticationConverter(
            AuthProperties properties) {
        var converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> authorities(jwt, properties.getAudience()));
        return converter;
    }

    /**
     * Keycloak-style resource roles are accepted only from the configured API
     * client. Roles from a different client must never become data-os API
     * authorities merely because they happen to be present in the same token.
     */
    Collection<GrantedAuthority> authorities(Jwt jwt, String resourceClientId) {
        Set<String> roles = new LinkedHashSet<>();
        addRoles(roles, jwt.getClaim("roles"));
        addRoles(roles, jwt.getClaim("groups"));
        var realmAccess = jwt.getClaimAsMap("realm_access");
        if (realmAccess != null) addRoles(roles, realmAccess.get("roles"));
        var resourceAccess = jwt.getClaimAsMap("resource_access");
        if (resourceAccess != null && resourceClientId != null && !resourceClientId.isBlank()) {
            var client = resourceAccess.get(resourceClientId.trim());
            if (client instanceof Map<?, ?> clientClaims) addRoles(roles, clientClaims.get("roles"));
        }
        var authorities = new ArrayList<GrantedAuthority>();
        roles.forEach(role -> authorities.add(new SimpleGrantedAuthority("ROLE_" + role)));
        return authorities;
    }

    AuthenticationEntryPoint jsonAuthenticationEntryPoint() {
        return (request, response, ignored) -> writeSecurityProblem(response, HttpStatus.UNAUTHORIZED,
                "UNAUTHENTICATED", "请先完成 OIDC 登录");
    }

    AccessDeniedHandler jsonAccessDeniedHandler() {
        return (request, response, ignored) -> writeSecurityProblem(response, HttpStatus.FORBIDDEN,
                "FORBIDDEN", "当前身份没有执行该操作的权限");
    }

    private void writeSecurityProblem(HttpServletResponse response, HttpStatus status, String code,
                                      String message) throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (status == HttpStatus.UNAUTHORIZED) response.setHeader("WWW-Authenticate", "Bearer");
        response.getWriter().write("{\"type\":\"about:blank\",\"title\":\"" + status.getReasonPhrase()
                + "\",\"status\":" + status.value() + ",\"code\":\"" + code
                + "\",\"message\":\"" + message + "\"}");
    }

    /** Validates the OIDC audience in addition to issuer and temporal claims. */
    static final class AudienceValidator implements OAuth2TokenValidator<Jwt> {

        private static final OAuth2Error INVALID_AUDIENCE = new OAuth2Error("invalid_token",
                "The required audience is missing", null);
        private final String expectedAudience;

        AudienceValidator(String expectedAudience) {
            this.expectedAudience = expectedAudience;
        }

        @Override
        public OAuth2TokenValidatorResult validate(Jwt token) {
            return token.getAudience().contains(expectedAudience)
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(INVALID_AUDIENCE);
        }
    }

    private void addRoles(Set<String> roles, Object value) {
        if (value instanceof Collection<?> collection) {
            collection.stream().map(String::valueOf).map(String::trim)
                    .map(this::normalizeRole)
                    .filter(item -> !item.isBlank()).forEach(roles::add);
        } else if (value instanceof String text && !text.isBlank()) {
            for (var role : text.split("[ ,]+")) {
                var normalized = normalizeRole(role);
                if (!normalized.isBlank()) roles.add(normalized);
            }
        }
    }

    private String normalizeRole(String value) {
        var role = value == null ? "" : value.trim();
        var withoutPrefix = role.regionMatches(true, 0, "ROLE_", 0, 5) ? role.substring(5).trim() : role;
        return withoutPrefix.toLowerCase(Locale.ROOT);
    }
}
