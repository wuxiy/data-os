package com.cywu.dataos.controlplane.mapping;

import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.executor.AdapterHttp;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.quality.OidcClientCredentialsTokenProvider;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * 质量执行器聚合验证客户端（G23）：POST /api/v1/mapping-validations。
 * 连接/鉴权/失败语义与 HttpQualityRuleExecutor 同款（JDK HttpClient HTTP/1.1、
 * client_credentials 可空、瞬态→AdapterUnavailable）；执行器侧 4xx 校验拒绝
 * 透传为 InvalidRequest（给调用方可操作的文案）。
 */
@Component
public class MappingValidationClient {

    private final RestClient restClient;
    private final OidcClientCredentialsTokenProvider tokenProvider;
    private final String baseUrl;

    public MappingValidationClient(
            RestClient.Builder builder,
            @Value("${data-os.quality.base-url:}") String baseUrl,
            @Value("${data-os.quality.oidc.token-uri:}") String tokenUri,
            @Value("${data-os.quality.oidc.client-id:}") String clientId,
            @Value("${data-os.quality.oidc.client-secret:}") String clientSecret,
            @Value("${data-os.quality.oidc.audience:}") String audience,
            @Value("${data-os.quality.oidc.scopes:}") String scopes) {
        this.baseUrl = AdapterHttp.normalizeBaseUrl(baseUrl);
        this.restClient = AdapterHttp.restClient(builder, java.time.Duration.ofSeconds(3), java.time.Duration.ofSeconds(60));
        this.tokenProvider = new OidcClientCredentialsTokenProvider(
                builder, tokenUri, clientId, clientSecret, audience, scopes);
    }

    public boolean configured() {
        return !baseUrl.isBlank();
    }

    /** 聚合验证：dataset + 映射项（带目标类型与值域）；返回执行器聚合结果。 */
    public JsonNode validate(String dataset, List<Map<String, Object>> items) {
        if (!configured()) {
            throw new AdapterUnavailableException("质量执行器未配置：请在控制面设置 data-os.quality.base-url");
        }
        try {
            return restClient.post()
                    .uri(baseUrl + "/api/v1/mapping-validations")
                    .headers(headers -> {
                        var token = tokenProvider.current();
                        if (!token.isBlank()) {
                            headers.setBearerAuth(token);
                        }
                    })
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("dataset", dataset, "items", items))
                    .retrieve()
                    .body(JsonNode.class);
        } catch (org.springframework.web.client.HttpClientErrorException.BadRequest
                 | org.springframework.web.client.HttpClientErrorException.UnprocessableEntity bad) {
            throw new InvalidRequestException("映射验证被拒绝：" + safeMessage(bad));
        } catch (org.springframework.web.client.HttpClientErrorException.Forbidden
                 | org.springframework.web.client.HttpClientErrorException.Unauthorized denied) {
            throw new AdapterUnavailableException("质量执行器拒绝服务身份：" + safeMessage(denied));
        } catch (org.springframework.web.client.RestClientException failure) {
            throw new AdapterUnavailableException("质量执行器暂时不可用：" + failure.getMessage());
        }
    }

    private static String safeMessage(Exception failure) {
        var message = failure.getMessage();
        return message == null ? "未知错误" : message.substring(0, Math.min(message.length(), 400));
    }
}
