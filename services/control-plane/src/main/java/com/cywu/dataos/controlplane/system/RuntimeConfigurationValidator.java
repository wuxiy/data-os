package com.cywu.dataos.controlplane.system;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.cywu.dataos.controlplane.credential.CredentialProperties;
import com.cywu.dataos.controlplane.security.AuthProperties;
import com.cywu.dataos.controlplane.source.SourceNetworkProperties;

/**
 * Prevents an explicitly marked production deployment from starting with demo-only data or executors.
 */
@Component
public final class RuntimeConfigurationValidator {

    private final String environment;
    private final boolean seedDemoEnabled;
    private final String qualityExecutor;
    private final boolean demoQualityExecutorEnabled;
    private final AuthProperties authProperties;
    private final CredentialProperties credentialProperties;
    private final SourceNetworkProperties sourceNetworkProperties;
    private final boolean strictSecurity;

    @Autowired
    public RuntimeConfigurationValidator(
            @Value("${data-os.runtime.environment:production}") String environment,
            @Value("${data-os.seed-demo:false}") boolean seedDemoEnabled,
            @Value("${data-os.quality.executor:HTTP}") String qualityExecutor,
            @Value("${data-os.quality.demo-enabled:false}") boolean demoQualityExecutorEnabled,
            AuthProperties authProperties, CredentialProperties credentialProperties,
            SourceNetworkProperties sourceNetworkProperties) {
        this.environment = environment;
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = qualityExecutor;
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.authProperties = authProperties;
        this.credentialProperties = credentialProperties;
        this.sourceNetworkProperties = sourceNetworkProperties;
        this.strictSecurity = true;
    }

    /** Compatibility constructor retained for focused unit tests. */
    public RuntimeConfigurationValidator(String environment, boolean seedDemoEnabled, String qualityExecutor,
                                         boolean demoQualityExecutorEnabled) {
        this.environment = environment;
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = qualityExecutor;
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.authProperties = new AuthProperties();
        this.credentialProperties = new CredentialProperties();
        this.sourceNetworkProperties = new SourceNetworkProperties();
        this.strictSecurity = false;
    }

    @PostConstruct
    public void validate() {
        if (strictSecurity) {
            var mode = normalize(authProperties.getMode()).toUpperCase(java.util.Locale.ROOT);
            if (!"ENFORCED".equals(mode) && !"DISABLED".equals(mode)) {
                throw new IllegalStateException("DATAOS_AUTH_MODE 仅支持 ENFORCED 或 DISABLED");
            }
            if (authProperties.isEnforced()
                    && (authProperties.getIssuerUri() == null || authProperties.getIssuerUri().isBlank())) {
                throw new IllegalStateException("启用 OIDC 时必须配置 DATAOS_OIDC_ISSUER_URI");
            }
            if (authProperties.getAudience() == null || authProperties.getAudience().isBlank()) {
                throw new IllegalStateException("必须配置非空 DATAOS_OIDC_AUDIENCE");
            }
            if (authProperties.getClockSkewSeconds() < 0 || authProperties.getClockSkewSeconds() > 300) {
                throw new IllegalStateException("DATAOS_OIDC_CLOCK_SKEW_SECONDS 必须在 0 到 300 秒之间");
            }
            if (sourceNetworkProperties.getMaxResponseBytes() < 1024
                    || sourceNetworkProperties.getMaxResponseBytes() > 1024 * 1024) {
                throw new IllegalStateException("DATAOS_SOURCE_MAX_RESPONSE_BYTES 必须在 1024 到 1048576 字节之间");
            }
        }
        if (!"production".equalsIgnoreCase(normalize(environment))) {
            return;
        }
        if (seedDemoEnabled || demoQualityExecutorEnabled || "DEMO".equalsIgnoreCase(normalize(qualityExecutor))) {
            throw new IllegalStateException(
                    "生产环境禁止启用演示种子数据或 DEMO 质量执行器，请设置 DATAOS_SEED_DEMO=false、"
                            + "DATAOS_QUALITY_EXECUTOR=HTTP/DBT、DATAOS_QUALITY_DEMO_ENABLED=false");
        }
        if (!strictSecurity) return;
        if (!authProperties.isEnforced() || authProperties.getIssuerUri() == null
                || authProperties.getIssuerUri().isBlank()) {
            throw new IllegalStateException("生产环境必须启用 OIDC，并配置 DATAOS_OIDC_ISSUER_URI");
        }
        if (!authProperties.getIssuerUri().trim().toLowerCase(java.util.Locale.ROOT).startsWith("https://")) {
            throw new IllegalStateException("生产环境 OIDC issuer 必须使用 HTTPS");
        }
        if (credentialProperties.getEncryptionKey() == null || credentialProperties.getEncryptionKey().isBlank()) {
            throw new IllegalStateException("生产环境必须配置 DATAOS_CREDENTIAL_ENCRYPTION_KEY");
        }
        var allowedHosts = sourceNetworkProperties.getAllowedHosts().stream()
                .filter(item -> item != null && !item.isBlank()).toList();
        if (sourceNetworkProperties.isAllowHttp() || sourceNetworkProperties.isAllowPrivateNetworks()
                || sourceNetworkProperties.isAllowTestProtocols() || allowedHosts.isEmpty()) {
            throw new IllegalStateException("生产环境必须使用 HTTPS、关闭内网/测试地址，并配置 DATAOS_SOURCE_ALLOWED_HOSTS");
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
