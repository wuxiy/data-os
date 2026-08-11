package com.cywu.dataos.controlplane.system;

import jakarta.annotation.PostConstruct;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import com.fasterxml.jackson.databind.ObjectMapper;
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
    private final String dolphinSchedulerTenantCode;
    private final String dolphinSchedulerToken;
    private final String dolphinSchedulerTokenFile;
    private final String dolphinSchedulerUsername;
    private final String dolphinSchedulerPassword;
    private final String qualityBaseUrl;
    private final String qualityOidcTokenUri;
    private final String qualityOidcClientId;
    private final String qualityOidcClientSecret;
    private final String notificationWebhookUrl;
    private final String notificationWebhookSecret;
    private final String notificationWebhookSecretFile;
    private final String notificationAllowedHosts;
    private final boolean strictSecurity;
    private final boolean externalHttpsTerminated;
    private final ObjectMapper objectMapper;

    private enum CompatibilityMode {
        DEMO_TEST
    }

    @Autowired
    public RuntimeConfigurationValidator(
            @Value("${data-os.runtime.environment:production}") String environment,
            @Value("${data-os.seed-demo:false}") boolean seedDemoEnabled,
            @Value("${data-os.quality.executor:HTTP}") String qualityExecutor,
            @Value("${data-os.quality.demo-enabled:false}") boolean demoQualityExecutorEnabled,
            @Value("${data-os.dolphinscheduler.tenant-code:}") String dolphinSchedulerTenantCode,
            @Value("${data-os.dolphinscheduler.token:}") String dolphinSchedulerToken,
            @Value("${data-os.dolphinscheduler.token-file:}") String dolphinSchedulerTokenFile,
            @Value("${data-os.dolphinscheduler.username:}") String dolphinSchedulerUsername,
            @Value("${data-os.dolphinscheduler.password:}") String dolphinSchedulerPassword,
            @Value("${data-os.quality.base-url:}") String qualityBaseUrl,
            @Value("${data-os.quality.oidc.token-uri:}") String qualityOidcTokenUri,
            @Value("${data-os.quality.oidc.client-id:}") String qualityOidcClientId,
            @Value("${data-os.quality.oidc.client-secret:}") String qualityOidcClientSecret,
            @Value("${data-os.notification.webhook-url:}") String notificationWebhookUrl,
            @Value("${data-os.notification.webhook-secret:}") String notificationWebhookSecret,
            @Value("${data-os.notification.webhook-secret-file:}") String notificationWebhookSecretFile,
            @Value("${data-os.notification.allowed-hosts:}") String notificationAllowedHosts,
            @Value("${data-os.runtime.external-https-terminated:false}") boolean externalHttpsTerminated,
            AuthProperties authProperties, CredentialProperties credentialProperties,
            SourceNetworkProperties sourceNetworkProperties, ObjectMapper objectMapper) {
        this.environment = environment;
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = qualityExecutor;
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.authProperties = authProperties;
        this.credentialProperties = credentialProperties;
        this.sourceNetworkProperties = sourceNetworkProperties;
        this.dolphinSchedulerTenantCode = dolphinSchedulerTenantCode == null ? "" : dolphinSchedulerTenantCode.trim();
        this.dolphinSchedulerToken = normalize(dolphinSchedulerToken);
        this.dolphinSchedulerTokenFile = normalize(dolphinSchedulerTokenFile);
        this.dolphinSchedulerUsername = normalize(dolphinSchedulerUsername);
        this.dolphinSchedulerPassword = normalize(dolphinSchedulerPassword);
        this.qualityBaseUrl = normalize(qualityBaseUrl);
        this.qualityOidcTokenUri = normalize(qualityOidcTokenUri);
        this.qualityOidcClientId = normalize(qualityOidcClientId);
        this.qualityOidcClientSecret = normalize(qualityOidcClientSecret);
        this.notificationWebhookUrl = normalize(notificationWebhookUrl);
        this.notificationWebhookSecret = normalize(notificationWebhookSecret);
        this.notificationWebhookSecretFile = normalize(notificationWebhookSecretFile);
        this.notificationAllowedHosts = normalize(notificationAllowedHosts);
        this.strictSecurity = true;
        this.externalHttpsTerminated = externalHttpsTerminated;
        this.objectMapper = objectMapper;
    }

    /** Compatibility constructor retained for focused unit tests. */
    public RuntimeConfigurationValidator(String environment, boolean seedDemoEnabled, String qualityExecutor,
                                         boolean demoQualityExecutorEnabled, AuthProperties authProperties,
                                         CredentialProperties credentialProperties,
                                         SourceNetworkProperties sourceNetworkProperties) {
        this.environment = environment;
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = qualityExecutor;
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.authProperties = authProperties;
        this.credentialProperties = credentialProperties;
        this.sourceNetworkProperties = sourceNetworkProperties;
        this.dolphinSchedulerTenantCode = "dataos-dev";
        this.dolphinSchedulerToken = "compatibility-token";
        this.dolphinSchedulerTokenFile = "";
        this.dolphinSchedulerUsername = "";
        this.dolphinSchedulerPassword = "";
        this.qualityBaseUrl = "https://quality.example.test";
        this.qualityOidcTokenUri = "https://id.example.test/token";
        this.qualityOidcClientId = "dataos-control-plane";
        this.qualityOidcClientSecret = "compatibility-secret";
        this.notificationWebhookUrl = "https://notify.example.test/data-os";
        this.notificationWebhookSecret = "compatibility-webhook-secret-32bytes";
        this.notificationWebhookSecretFile = "";
        this.notificationAllowedHosts = "notify.example.test";
        this.strictSecurity = true;
        this.externalHttpsTerminated = true;
        this.objectMapper = new ObjectMapper();
    }

    /** Compatibility constructor preserving the historical explicit tenant argument in tests. */
    public RuntimeConfigurationValidator(String environment, boolean seedDemoEnabled, String qualityExecutor,
                                         boolean demoQualityExecutorEnabled, String tenantCode,
                                         AuthProperties authProperties, CredentialProperties credentialProperties,
                                         SourceNetworkProperties sourceNetworkProperties) {
        this.environment = environment;
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = qualityExecutor;
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.authProperties = authProperties;
        this.credentialProperties = credentialProperties;
        this.sourceNetworkProperties = sourceNetworkProperties;
        this.dolphinSchedulerTenantCode = normalize(tenantCode);
        this.dolphinSchedulerToken = "compatibility-token";
        this.dolphinSchedulerTokenFile = "";
        this.dolphinSchedulerUsername = "";
        this.dolphinSchedulerPassword = "";
        this.qualityBaseUrl = "https://quality.example.test";
        this.qualityOidcTokenUri = "https://id.example.test/token";
        this.qualityOidcClientId = "dataos-control-plane";
        this.qualityOidcClientSecret = "compatibility-secret";
        this.notificationWebhookUrl = "https://notify.example.test/data-os";
        this.notificationWebhookSecret = "compatibility-webhook-secret-32bytes";
        this.notificationWebhookSecretFile = "";
        this.notificationAllowedHosts = "notify.example.test";
        this.strictSecurity = true;
        this.externalHttpsTerminated = true;
        this.objectMapper = new ObjectMapper();
    }

    /** Minimal compatibility constructor retained for demo-only tests. */
    public RuntimeConfigurationValidator(String environment, boolean seedDemoEnabled, String qualityExecutor,
                                         boolean demoQualityExecutorEnabled) {
        this(environment, seedDemoEnabled, qualityExecutor, demoQualityExecutorEnabled, CompatibilityMode.DEMO_TEST);
    }

    private RuntimeConfigurationValidator(String environment, boolean seedDemoEnabled, String qualityExecutor,
                                          boolean demoQualityExecutorEnabled, CompatibilityMode compatibilityMode) {
        this.environment = environment;
        this.seedDemoEnabled = seedDemoEnabled;
        this.qualityExecutor = qualityExecutor;
        this.demoQualityExecutorEnabled = demoQualityExecutorEnabled;
        this.authProperties = new AuthProperties();
        this.credentialProperties = new CredentialProperties();
        this.sourceNetworkProperties = new SourceNetworkProperties();
        this.dolphinSchedulerTenantCode = "dataos-dev";
        this.dolphinSchedulerToken = "";
        this.dolphinSchedulerTokenFile = "";
        this.dolphinSchedulerUsername = "";
        this.dolphinSchedulerPassword = "";
        this.qualityBaseUrl = "";
        this.qualityOidcTokenUri = "";
        this.qualityOidcClientId = "";
        this.qualityOidcClientSecret = "";
        this.notificationWebhookUrl = "";
        this.notificationWebhookSecret = "";
        this.notificationWebhookSecretFile = "";
        this.notificationAllowedHosts = "";
        this.strictSecurity = false;
        this.externalHttpsTerminated = true;
        this.objectMapper = new ObjectMapper();
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
        var normalizedEnvironment = RuntimeEnvironment.normalize(environment);
        if (!"production".equals(normalizedEnvironment)) {
            return;
        }
        if (seedDemoEnabled || demoQualityExecutorEnabled || "DEMO".equalsIgnoreCase(normalize(qualityExecutor))) {
            throw new IllegalStateException(
                    "生产环境禁止启用演示种子数据或 DEMO 质量执行器，请设置 DATAOS_SEED_DEMO=false、"
                            + "DATAOS_QUALITY_EXECUTOR=HTTP/DBT、DATAOS_QUALITY_DEMO_ENABLED=false");
        }
        if (!strictSecurity) return;
        if (!externalHttpsTerminated) {
            throw new IllegalStateException(
                    "生产环境必须由受控入口终止 HTTPS，并设置 DATAOS_EXTERNAL_HTTPS_TERMINATED=true");
        }
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
        if (authProperties.isAllowDefaultScope()) {
            throw new IllegalStateException("生产环境必须关闭 DATAOS_DEFAULT_SCOPE_ENABLED，禁止默认租户回退");
        }
        if (isDefaultValue(authProperties.getDefaultTenantId(), "default")
                || authProperties.getDefaultTenantId() == null || authProperties.getDefaultTenantId().isBlank()) {
            throw new IllegalStateException("生产环境必须配置命名 DATAOS_DEFAULT_TENANT_ID");
        }
        if (isDefaultValue(authProperties.getDefaultInstitutionId(), "demo-hospital")
                || authProperties.getDefaultInstitutionId() == null || authProperties.getDefaultInstitutionId().isBlank()) {
            throw new IllegalStateException("生产环境必须配置命名 DATAOS_DEFAULT_INSTITUTION_ID");
        }
        if (dolphinSchedulerTenantCode.isBlank() || "default".equalsIgnoreCase(dolphinSchedulerTenantCode)) {
            throw new IllegalStateException("生产环境必须配置命名 DATAOS_DOLPHINSCHEDULER_TENANT_CODE");
        }
        if (dolphinSchedulerToken.isBlank() && dolphinSchedulerTokenFile.isBlank()) {
            throw new IllegalStateException("生产环境必须配置 DolphinScheduler Token 文件或 Secret");
        }
        if (!dolphinSchedulerUsername.isBlank() || !dolphinSchedulerPassword.isBlank()) {
            throw new IllegalStateException("生产环境禁止配置 DolphinScheduler 用户名/密码回退");
        }
        if (!("HTTP".equalsIgnoreCase(normalize(qualityExecutor))
                || "DBT".equalsIgnoreCase(normalize(qualityExecutor)))) {
            throw new IllegalStateException("生产环境质量执行器只能是 HTTP 或 DBT");
        }
        if (qualityBaseUrl.isBlank()) {
            throw new IllegalStateException("生产环境必须配置 DATAOS_QUALITY_EXECUTOR_BASE_URL");
        }
        if (qualityOidcTokenUri.isBlank() || qualityOidcClientId.isBlank() || qualityOidcClientSecret.isBlank()) {
            throw new IllegalStateException("生产环境必须配置质量 Runtime 的 OIDC Client Credentials");
        }
        if (!qualityOidcTokenUri.toLowerCase(java.util.Locale.ROOT).startsWith("https://")) {
            throw new IllegalStateException("生产环境质量 Runtime OIDC token URI 必须使用 HTTPS");
        }
        if (notificationWebhookUrl.isBlank()) {
            throw new IllegalStateException("生产环境必须配置 DATAOS_NOTIFICATION_WEBHOOK_URL");
        }
        if (notificationWebhookSecret.isBlank() && notificationWebhookSecretFile.isBlank()) {
            throw new IllegalStateException("生产环境必须配置责任人 Webhook 签名密钥或 Secret 文件");
        }
        if (!notificationWebhookSecret.isBlank() && notificationWebhookSecret.length() < 32) {
            throw new IllegalStateException("生产环境责任人 Webhook 签名密钥至少需要 32 个字符");
        }
        if (!notificationWebhookSecretFile.isBlank() && !isStrongWebhookSecretFile()) {
            throw new IllegalStateException("生产环境责任人 Webhook Secret 文件必须可读且 current 密钥至少需要 32 个字符");
        }
        if (notificationAllowedHosts.isBlank()) {
            throw new IllegalStateException("生产环境必须配置 DATAOS_NOTIFICATION_ALLOWED_HOSTS");
        }
        var allowedHosts = sourceNetworkProperties.getAllowedHosts().stream()
                .filter(item -> item != null && !item.isBlank()).toList();
        if (sourceNetworkProperties.isAllowHttp() || sourceNetworkProperties.isAllowTestProtocols()
                || allowedHosts.isEmpty()) {
            throw new IllegalStateException("生产环境必须使用 HTTPS、关闭测试协议，并配置 DATAOS_SOURCE_ALLOWED_HOSTS");
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    private boolean isDefaultValue(String value, String defaultValue) {
        return value != null && defaultValue.equalsIgnoreCase(value.trim());
    }

    private boolean isStrongWebhookSecretFile() {
        try {
            var path = Path.of(notificationWebhookSecretFile);
            if (!Files.isRegularFile(path) || !Files.isReadable(path)) return false;
            var root = objectMapper.readTree(Files.readString(path, StandardCharsets.UTF_8));
            var current = root == null ? "" : root.path("current").asText("").trim();
            return current.length() >= 32;
        } catch (Exception ignored) {
            // Do not leak a secret path or file contents in the startup error.
            return false;
        }
    }
}
