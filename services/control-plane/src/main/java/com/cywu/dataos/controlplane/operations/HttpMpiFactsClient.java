package com.cywu.dataos.controlplane.operations;

import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * MPI 指标 HTTP 实现：只读 GET /api/v1/mpi/metrics（dev 为内网直连免鉴权口径；
 * 若后续 mpi 开启 internal 强制认证，此处升级为服务令牌，见 H2 internal-mode 设计）。
 */
@Component
@ConditionalOnExpression("!'${data-os.operations.mpi-base-url:}'.isBlank()")
public class HttpMpiFactsClient implements MpiFactsClient {

    private final RestClient restClient;
    private final String baseUrl;

    public HttpMpiFactsClient(@Value("${data-os.operations.mpi-base-url}") String baseUrl) {
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.restClient = RestClient.builder().build();
    }

    @Override
    public long reviewPending() {
        try {
            var body = restClient.get()
                    .uri(baseUrl + "/api/v1/mpi/metrics")
                    .retrieve()
                    .body(Map.class);
            var pending = body == null ? null : body.get("reviewPending");
            return pending == null ? 0L : Long.parseLong(String.valueOf(pending));
        } catch (RuntimeException failure) {
            throw new IllegalStateException("MPI 指标不可达: " + failure.getMessage(), failure);
        }
    }
}
