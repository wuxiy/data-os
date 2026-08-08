package com.cywu.dataos.controlplane.security;

import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

/**
 * Resolves scope from the authenticated OIDC claims. Request parameters may
 * narrow a scope, but can never replace the tenant/institution from the token.
 */
@Component
public class TenantScope {

    private final AuthProperties properties;

    public TenantScope(AuthProperties properties) {
        this.properties = properties;
    }

    public Scope resolve(String requestedTenant, String requestedInstitution) {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (properties.isDisabled() || authentication == null || !authentication.isAuthenticated()) {
            if (!properties.isAllowDefaultScope()) {
                throw new AccessDeniedException("当前运行环境禁止默认租户回退");
            }
            return new Scope(properties.getDefaultTenantId(), properties.getDefaultInstitutionId(),
                    "local-development", List.of("platform-admin"));
        }
        if (!(authentication instanceof JwtAuthenticationToken jwtAuthentication)) {
            throw new AccessDeniedException("当前身份不是受信任的 OIDC 身份");
        }
        var jwt = jwtAuthentication.getToken();
        var tenant = claim(jwt.getClaims(), "tenant_id");
        var institution = claim(jwt.getClaims(), "institution_id");
        if (tenant.isBlank() || institution.isBlank()) {
            throw new AccessDeniedException("OIDC Token 缺少 tenant_id 或 institution_id");
        }
        var resolvedTenant = resolveRequested(tenant, requestedTenant, "tenantId");
        var resolvedInstitution = resolveRequested(institution, requestedInstitution, "institutionId");
        return new Scope(resolvedTenant, resolvedInstitution,
                jwt.getSubject(), jwtAuthentication.getAuthorities().stream()
                        .map(item -> item.getAuthority().replaceFirst("^ROLE_", ""))
                        .toList());
    }

    public Scope current() {
        return resolve(null, null);
    }

    private String resolveRequested(String actual, String requested, String field) {
        if (requested == null || requested.isBlank()) return actual;
        var normalized = requested.trim();
        if (!actual.equals(normalized)) {
            // A caller attempting to select another tenant/institution is an
            // authorization violation, not malformed input. Returning 403 is
            // important because it prevents clients from treating this as a
            // retryable validation error and gives operators an audit signal.
            throw new AccessDeniedException(field + " 不属于当前登录身份的授权范围");
        }
        return normalized;
    }

    private String claim(Map<String, Object> claims, String key) {
        var value = claims.get(key);
        return value == null ? "" : String.valueOf(value).trim();
    }

    public record Scope(String tenantId, String institutionId, String subject, List<String> roles) {
        public boolean hasRole(String role) {
            return roles.stream().map(item -> item.toLowerCase(Locale.ROOT))
                    .anyMatch(item -> item.equals(role.toLowerCase(Locale.ROOT)));
        }
    }
}
