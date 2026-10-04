package com.cywu.dataos.controlplane.quality;

import java.time.Duration;
import java.util.Map;

import com.cywu.dataos.controlplane.api.ErrorMessages;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.executor.AdapterHttp;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 动态质量规则推送（G2G 批次 2）：把定义台账的完整意图推给 runner——runner
 * 校验并编译为 singular test SQL 后落 registry。复用质量执行器的连接与
 * OIDC 客户端凭据形态，scope 增加 quality:admin。
 */
@Component
public class DynamicRulePushClient {

    private final RestClient restClient;
    private final String baseUrl;
    private final OidcClientCredentialsTokenProvider tokenProvider;

    @Autowired
    public DynamicRulePushClient(RestClient.Builder builder,
                                 @Value("${data-os.quality.base-url:}") String baseUrl,
                                 @Value("${data-os.quality.oidc.token-uri:}") String tokenUri,
                                 @Value("${data-os.quality.oidc.client-id:}") String clientId,
                                 @Value("${data-os.quality.oidc.client-secret:}") String clientSecret,
                                 @Value("${data-os.quality.oidc.audience:dataos-quality-runner}") String audience,
                                 @Value("${data-os.quality.oidc.admin-scopes:quality:admin}") String adminScopes) {
        this(builder, baseUrl, new OidcClientCredentialsTokenProvider(builder, tokenUri, clientId, clientSecret,
                audience, adminScopes));
    }

    DynamicRulePushClient(RestClient.Builder builder, String baseUrl) {
        this(builder, baseUrl, new OidcClientCredentialsTokenProvider(builder, "", "", "", "", ""));
    }

    private DynamicRulePushClient(RestClient.Builder builder, String baseUrl,
                                  OidcClientCredentialsTokenProvider tokenProvider) {
        this.restClient = AdapterHttp.restClient(builder, Duration.ofSeconds(3), Duration.ofSeconds(15));
        this.baseUrl = AdapterHttp.normalizeBaseUrl(baseUrl);
        this.tokenProvider = tokenProvider;
    }

    public boolean configured() {
        return !baseUrl.isBlank();
    }

    /** 保存/启用推送：runner 编译失败（400）如实透传给门户。 */
    public void push(QualityRuleDefinition definition) {
        requireConfigured();
        try {
            restClient.put()
                    .uri(baseUrl + "/api/v1/quality/rules/dynamic/{ruleId}", definition.ruleId())
                    .headers(this::authorize)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "ruleId", definition.ruleId(),
                            "ruleType", definition.ruleType(),
                            "datasetId", definition.datasetId(),
                            "column", definition.targetColumn() == null ? "" : definition.targetColumn(),
                            "params", definition.params(),
                            "evidenceColumns", definition.evidenceColumns()))
                    .retrieve()
                    .toBodilessEntity();
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() >= 500) {
                throw unavailable(exception);
            }
            throw new InvalidRequestException(runnerDetail(exception, "动态规则定义被质量执行器拒绝"));
        } catch (RestClientException exception) {
            throw unavailable(exception);
        }
    }

    /** 下线推送：禁用 registry 条目并移除生成的 SQL 文件；404 视为已下线。 */
    public void disable(String ruleId) {
        requireConfigured();
        try {
            restClient.delete()
                    .uri(baseUrl + "/api/v1/quality/rules/dynamic/{ruleId}", ruleId)
                    .headers(this::authorize)
                    .retrieve()
                    .toBodilessEntity();
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() == 404) return;
            if (exception.getStatusCode().value() >= 500) {
                throw unavailable(exception);
            }
            throw new InvalidRequestException(runnerDetail(exception, "动态规则下线被质量执行器拒绝"));
        } catch (RestClientException exception) {
            throw unavailable(exception);
        }
    }

    private void authorize(HttpHeaders headers) {
        var token = tokenProvider.current();
        if (!token.isBlank()) headers.setBearerAuth(token);
    }

    private void requireConfigured() {
        if (baseUrl.isBlank()) {
            throw new AdapterUnavailableException("质量执行器未配置，动态规则需要运行中的质量执行器");
        }
    }

    private AdapterUnavailableException unavailable(Exception exception) {
        return new AdapterUnavailableException("质量执行器暂时不可用：" + ErrorMessages.safe(exception));
    }

    private String runnerDetail(HttpClientErrorException exception, String fallback) {
        try {
            var body = new com.fasterxml.jackson.databind.ObjectMapper().readValue(
                    exception.getResponseBodyAsByteArray(), Map.class);
            Object detail = body == null ? null : body.get("detail");
            return detail == null || String.valueOf(detail).isBlank()
                    ? fallback : fallback + "：" + detail;
        } catch (Exception ignored) {
            return fallback + "（HTTP " + exception.getStatusCode().value() + "）";
        }
    }
}
