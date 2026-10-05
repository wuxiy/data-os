package com.cywu.dataos.controlplane.operations;

import java.time.Duration;
import java.util.Map;

import com.cywu.dataos.controlplane.executor.AdapterHttp;
import com.cywu.dataos.controlplane.quality.OidcClientCredentialsTokenProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * MPI 指标 HTTP 实现：只读 GET /api/v1/mpi/metrics。G2G B 组收口：MPI 切
 * ENFORCED 后须带服务 token（client_credentials，aud=data-os-mpi）；凭据未
 * 配置时不发 Authorization 头，DISABLED 直连口径保持不变。
 */
@Component
@ConditionalOnExpression("!'${data-os.operations.mpi-base-url:}'.isBlank()")
public class HttpMpiFactsClient implements MpiFactsClient {

    private final RestClient restClient;
    private final String baseUrl;
    private final OidcClientCredentialsTokenProvider tokenProvider;

    @Autowired
    public HttpMpiFactsClient(RestClient.Builder builder,
                              @Value("${data-os.operations.mpi-base-url}") String baseUrl,
                              @Value("${data-os.operations.mpi.oidc.token-uri:}") String tokenUri,
                              @Value("${data-os.operations.mpi.oidc.client-id:}") String clientId,
                              @Value("${data-os.operations.mpi.oidc.client-secret:}") String clientSecret,
                              @Value("${data-os.operations.mpi.oidc.audience:data-os-mpi}") String audience) {
        this(builder, baseUrl, new OidcClientCredentialsTokenProvider(builder, tokenUri, clientId, clientSecret,
                audience, ""));
    }

    HttpMpiFactsClient(RestClient.Builder builder, String baseUrl) {
        this(builder, baseUrl, new OidcClientCredentialsTokenProvider(builder, "", "", "", "", ""));
    }

    private HttpMpiFactsClient(RestClient.Builder builder, String baseUrl,
                               OidcClientCredentialsTokenProvider tokenProvider) {
        this.restClient = AdapterHttp.restClient(builder, Duration.ofSeconds(3), Duration.ofSeconds(10));
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.tokenProvider = tokenProvider;
    }

    @Override
    public long reviewPending() {
        try {
            var body = restClient.get()
                    .uri(baseUrl + "/api/v1/mpi/metrics")
                    .headers(this::authorize)
                    .retrieve()
                    .body(Map.class);
            var pending = body == null ? null : body.get("reviewPending");
            return pending == null ? 0L : Long.parseLong(String.valueOf(pending));
        } catch (RuntimeException failure) {
            throw new IllegalStateException("MPI 指标不可达: " + failure.getMessage(), failure);
        }
    }

    private void authorize(HttpHeaders headers) {
        var token = tokenProvider.current();
        if (!token.isBlank()) headers.setBearerAuth(token);
    }
}
