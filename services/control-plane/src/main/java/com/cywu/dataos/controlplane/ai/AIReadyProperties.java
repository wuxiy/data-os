package com.cywu.dataos.controlplane.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * AI Ready 引擎连接配置（G9）。base-url 未配置时引擎 bean 不装配，
 * build 维持 G8 的 503 守护语义（AI_READY_ENGINE_NOT_CONFIGURED）。
 */
@ConfigurationProperties(prefix = "data-os.ai-ready")
public class AIReadyProperties {

    /** 引擎服务根（如 http://ai-ready-service:8080）。 */
    private String baseUrl = "";

    /** OIDC client credentials（与 quality-runner 同模式）；空则用静态令牌。 */
    private String tokenUri = "";
    private String clientId = "";
    private String clientSecret = "";

    /** 静态共享令牌（AI_READY_API_TOKEN 同值）；OIDC 未配置时使用。 */
    private String apiToken = "";

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
    }

    public String getTokenUri() {
        return tokenUri;
    }

    public void setTokenUri(String tokenUri) {
        this.tokenUri = tokenUri == null ? "" : tokenUri.trim();
    }

    public String getClientId() {
        return clientId;
    }

    public void setClientId(String clientId) {
        this.clientId = clientId == null ? "" : clientId.trim();
    }

    public String getClientSecret() {
        return clientSecret;
    }

    public void setClientSecret(String clientSecret) {
        this.clientSecret = clientSecret == null ? "" : clientSecret.trim();
    }

    public String getApiToken() {
        return apiToken;
    }

    public void setApiToken(String apiToken) {
        this.apiToken = apiToken == null ? "" : apiToken.trim();
    }
}
