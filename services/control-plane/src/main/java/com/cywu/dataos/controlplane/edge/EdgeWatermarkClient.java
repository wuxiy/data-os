package com.cywu.dataos.controlplane.edge;

import java.time.Duration;
import java.util.Map;

import com.cywu.dataos.controlplane.api.ErrorMessages;
import com.cywu.dataos.controlplane.executor.AdapterHttp;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.quality.OidcClientCredentialsTokenProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 前置机采集水位代理（G2G 批次 4 第二刀）：转发 quality-runner 的白名单
 * 聚合只读端点（边缘表 COUNT/MAX/按日计数）；复用质量执行器连接与 OIDC
 * 形态，scope 用 quality:read。
 */
@Component
public class EdgeWatermarkClient {

    private final RestClient restClient;
    private final String baseUrl;
    private final OidcClientCredentialsTokenProvider tokenProvider;

    @Autowired
    public EdgeWatermarkClient(RestClient.Builder builder,
                               @Value("${data-os.quality.base-url:}") String baseUrl,
                               @Value("${data-os.quality.oidc.token-uri:}") String tokenUri,
                               @Value("${data-os.quality.oidc.client-id:}") String clientId,
                               @Value("${data-os.quality.oidc.client-secret:}") String clientSecret,
                               @Value("${data-os.quality.oidc.audience:dataos-quality-runner}") String audience,
                               @Value("${data-os.quality.oidc.scopes:quality:submit quality:read}") String scopes) {
        this(builder, baseUrl, new OidcClientCredentialsTokenProvider(builder, tokenUri, clientId, clientSecret,
                audience, scopes));
    }

    EdgeWatermarkClient(RestClient.Builder builder, String baseUrl) {
        this(builder, baseUrl, new OidcClientCredentialsTokenProvider(builder, "", "", "", "", ""));
    }

    private EdgeWatermarkClient(RestClient.Builder builder, String baseUrl,
                                OidcClientCredentialsTokenProvider tokenProvider) {
        this.restClient = AdapterHttp.restClient(builder, Duration.ofSeconds(3), Duration.ofSeconds(15));
        this.baseUrl = AdapterHttp.normalizeBaseUrl(baseUrl);
        this.tokenProvider = tokenProvider;
    }

    public boolean configured() {
        return !baseUrl.isBlank();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> watermarks() {
        if (baseUrl.isBlank()) {
            throw new AdapterUnavailableException("质量执行器未配置，采集水位需要运行中的质量执行器");
        }
        try {
            var response = restClient.get()
                    .uri(baseUrl + "/api/v1/edge/watermarks")
                    .headers(this::authorize)
                    .retrieve()
                    .body(Map.class);
            return response == null ? Map.of() : response;
        } catch (HttpClientErrorException exception) {
            throw new AdapterUnavailableException(
                    "采集水位查询被质量执行器拒绝（HTTP " + exception.getStatusCode().value() + "）");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("质量执行器暂时不可用：" + ErrorMessages.safe(exception));
        }
    }

    private void authorize(HttpHeaders headers) {
        var token = tokenProvider.current();
        if (!token.isBlank()) headers.setBearerAuth(token);
    }
}
