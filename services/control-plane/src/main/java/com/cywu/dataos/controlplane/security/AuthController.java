package com.cywu.dataos.controlplane.security;

import java.util.Map;

import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final TenantScope tenantScope;
    private final AuthProperties properties;

    public AuthController(TenantScope tenantScope, AuthProperties properties) {
        this.tenantScope = tenantScope;
        this.properties = properties;
    }

    @GetMapping("/me")
    public AuthMeResponse me(Authentication authentication) {
        var scope = tenantScope.current();
        var subject = scope.subject();
        var username = subject;
        if (authentication instanceof JwtAuthenticationToken token) {
            username = token.getToken().getClaimAsString("preferred_username");
            if (username == null || username.isBlank()) username = subject;
        }
        return new AuthMeResponse(username, subject, scope.tenantId(), scope.institutionId(), scope.roles(),
                properties.isEnforced() ? "OIDC" : "DISABLED");
    }

    public record AuthMeResponse(String username, String subject, String tenantId, String institutionId,
                                 java.util.List<String> roles, String mode) {
    }
}
