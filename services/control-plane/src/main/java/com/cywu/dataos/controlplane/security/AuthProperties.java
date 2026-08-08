package com.cywu.dataos.controlplane.security;

import java.util.Locale;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * OIDC is the only production authentication source. DISABLED is intentionally
 * available only for local development and tests where the portal talks to an
 * isolated control plane without a Keycloak realm.
 */
@ConfigurationProperties(prefix = "data-os.auth")
public class AuthProperties {

    private String mode = "ENFORCED";
    private String issuerUri = "";
    private String audience = "data-os";
    private long clockSkewSeconds = 60;
    private String defaultTenantId = "default";
    private String defaultInstitutionId = "demo-hospital";
    private boolean allowDefaultScope = true;

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode == null ? "" : mode.trim().toUpperCase(Locale.ROOT);
    }

    public String getIssuerUri() {
        return issuerUri;
    }

    public void setIssuerUri(String issuerUri) {
        this.issuerUri = issuerUri;
    }

    public String getAudience() {
        return audience;
    }

    public void setAudience(String audience) {
        this.audience = audience;
    }

    public long getClockSkewSeconds() {
        return clockSkewSeconds;
    }

    public void setClockSkewSeconds(long clockSkewSeconds) {
        this.clockSkewSeconds = clockSkewSeconds;
    }

    public String getDefaultTenantId() {
        return defaultTenantId;
    }

    public void setDefaultTenantId(String defaultTenantId) {
        this.defaultTenantId = defaultTenantId;
    }

    public String getDefaultInstitutionId() {
        return defaultInstitutionId;
    }

    public void setDefaultInstitutionId(String defaultInstitutionId) {
        this.defaultInstitutionId = defaultInstitutionId;
    }

    public boolean isAllowDefaultScope() {
        return allowDefaultScope;
    }

    public void setAllowDefaultScope(boolean allowDefaultScope) {
        this.allowDefaultScope = allowDefaultScope;
    }

    public boolean isEnforced() {
        return "ENFORCED".equalsIgnoreCase(normalize(mode));
    }

    public boolean isDisabled() {
        return "DISABLED".equalsIgnoreCase(normalize(mode));
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
