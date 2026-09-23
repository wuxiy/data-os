package com.cywu.dataos.controlplane.assistant;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.quality.OidcClientCredentialsTokenProvider;

/**
 * 问数执行客户端（G26）：控制面 → Data API `/internal/v1/verified-queries/
 * {serviceCode}/query`。服务身份经 OIDC client_credentials（独立 client
 * dataos-assistant-bff，audience dataos-data-api）；未配置时 fail-closed
 *（问数拒答 UNAVAILABLE，不降级直连）。错误按语义归一：
 * 404=服务下线、400=参数被拒、429=限流、401/403/5xx/网络=不可用。
 */
@Component
public class AssistantDataApiClient {

    /** 执行结果（rows 为受限行集，超出 maxRows 截断）。 */
    public record QueryResult(String serviceCode, String serviceVersion, java.util.List<String> columns,
                              java.util.List<java.util.List<Object>> rows, int rowCount,
                              boolean truncated, int elapsedMs) {
    }

    /** 语义化失败：kind 决定问数侧拒答口径。 */
    public static class QueryRejected extends RuntimeException {
        public final String kind;  // SERVICE_OFFLINE / PARAM_REJECTED / RATE_LIMITED / UNAVAILABLE

        public QueryRejected(String kind, String message) {
            super(message);
            this.kind = kind;
        }
    }

    private final RestClient client;
    private final OidcClientCredentialsTokenProvider tokenProvider;

    public AssistantDataApiClient(RestClient.Builder builder,
                                  @Value("${data-os.assistant.data-api-base-url:}") String baseUrl,
                                  @Value("${data-os.assistant.oidc.token-uri:}") String tokenUri,
                                  @Value("${data-os.assistant.oidc.client-id:}") String clientId,
                                  @Value("${data-os.assistant.oidc.client-secret:}") String clientSecret,
                                  @Value("${data-os.assistant.oidc.audience:}") String audience) {
        this.client = baseUrl == null || baseUrl.isBlank()
                ? null
                : builder.baseUrl(baseUrl.trim()).build();
        this.tokenProvider = new OidcClientCredentialsTokenProvider(builder,
                tokenUri, clientId, clientSecret, audience, "");
    }

    /** 是否已配置（未配置时问数面诚实拒答 UNAVAILABLE，不静默降级）。 */
    public boolean configured() {
        return client != null && !tokenProvider.current().isBlank();
    }

    public QueryResult query(String serviceCode, Map<String, Object> parameters) {
        if (client == null) {
            throw new AdapterUnavailableException("问数执行面未配置：data-os.assistant.data-api-base-url");
        }
        var token = tokenProvider.current();
        if (token.isBlank()) {
            throw new AdapterUnavailableException(
                    "问数服务身份未配置：data-os.assistant.oidc.*（client_credentials 不可用）");
        }
        Map<String, Object> body;
        try {
            body = client.post()
                    .uri("/internal/v1/verified-queries/{code}/query", serviceCode)
                    .headers(headers -> headers.setBearerAuth(token))
                    .header("Content-Type", "application/json")
                    .body(Map.of("parameters", parameters))
                    .retrieve()
                    .body(Map.class);
        } catch (org.springframework.web.client.HttpClientErrorException.NotFound exception) {
            throw new QueryRejected("SERVICE_OFFLINE", "服务不存在或未发布: " + serviceCode);
        } catch (org.springframework.web.client.HttpClientErrorException.BadRequest exception) {
            throw new QueryRejected("PARAM_REJECTED", "执行面参数校验未通过: "
                    + exception.getResponseBodyAsString());
        } catch (org.springframework.web.client.HttpClientErrorException.TooManyRequests exception) {
            throw new QueryRejected("RATE_LIMITED", "问数执行面限流中，请稍后重试");
        } catch (org.springframework.web.client.HttpClientErrorException.Unauthorized
                 | org.springframework.web.client.HttpClientErrorException.Forbidden exception) {
            throw new AdapterUnavailableException("问数服务身份被 Data API 拒绝（audience/client 配置）");
        } catch (org.springframework.web.client.RestClientException exception) {
            throw new AdapterUnavailableException("问数执行面暂时不可用: " + exception.getMessage());
        }
        if (body == null) {
            throw new AdapterUnavailableException("问数执行面返回空响应");
        }
        var columns = body.get("columns") instanceof java.util.List<?> list
                ? list.stream().map(String::valueOf).toList() : java.util.List.<String>of();
        var rows = body.get("rows") instanceof java.util.List<?> list
                ? list.stream().map(row -> (java.util.List<Object>) row).toList()
                : java.util.List.<java.util.List<Object>>of();
        return new QueryResult(
                String.valueOf(body.getOrDefault("service", serviceCode)),
                String.valueOf(body.getOrDefault("version", "")),
                columns, rows,
                body.get("rowCount") instanceof Number number ? number.intValue() : rows.size(),
                Boolean.TRUE.equals(body.get("truncated")),
                body.get("elapsedMs") instanceof Number number ? number.intValue() : 0);
    }
}
