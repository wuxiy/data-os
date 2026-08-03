package com.cywu.dataos.controlplane.executor;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

import com.cywu.dataos.controlplane.job.IngestionJob;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class SeaTunnelExecutorAdapter implements ExecutorAdapter {

    private static final int MAX_SUBMIT_ATTEMPTS = 2;
    private static final long RETRY_BACKOFF_MILLIS = 250;

    private final RestClient restClient;
    private final String baseUrl;

    public SeaTunnelExecutorAdapter(RestClient.Builder builder,
                                    @Value("${data-os.seatunnel.base-url:}") String baseUrl) {
        var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(client);
        requestFactory.setReadTimeout(Duration.ofSeconds(10));
        this.restClient = builder.requestFactory(requestFactory).build();
        this.baseUrl = normalizeBaseUrl(baseUrl);
    }

    @Override
    public boolean supports(String executor) {
        return "SEATUNNEL".equalsIgnoreCase(executor);
    }

    @Override
    public AdapterSubmission submit(IngestionJob job, Map<String, Object> requestConfig) {
        if (baseUrl.isBlank()) {
            throw new AdapterUnavailableException("中心采集执行器未配置");
        }
        if (requestConfig.isEmpty()) {
            throw new AdapterConfigurationException("未提供中心采集作业配置");
        }

        var config = new HashMap<>(requestConfig);
        var env = new HashMap<String, Object>();
        if (config.get("env") instanceof Map<?, ?> existingEnv) {
            existingEnv.forEach((key, value) -> env.put(String.valueOf(key), value));
        }
        env.putIfAbsent("job.name", job.name());
        var requestedMode = env.get("job.mode");
        env.put("job.mode", toSeaTunnelMode(requestedMode == null ? job.mode() : String.valueOf(requestedMode)));
        config.put("env", env);

        try {
            var response = submitWithRetry(config);
            var externalId = response == null || response.get("jobId") == null
                    ? null : String.valueOf(response.get("jobId"));
            return new AdapterSubmission(externalId, "中心采集执行器已接受提交");
        } catch (HttpClientErrorException exception) {
            if (isRetryable(exception)) {
                throw new AdapterUnavailableException("中心采集执行器暂时不可用（HTTP "
                        + exception.getStatusCode().value() + "）");
            }
            throw new AdapterConfigurationException("中心采集作业配置不合法（HTTP "
                    + exception.getStatusCode().value() + "）");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException(safeMessage(exception));
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> submitWithRetry(Map<String, Object> config) {
        for (var attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
            try {
                return restClient.post()
                        .uri(baseUrl + "/submit-job")
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(config)
                        .retrieve()
                        .body(Map.class);
            } catch (HttpClientErrorException | HttpServerErrorException exception) {
                if (!isRetryable(exception) || attempt == MAX_SUBMIT_ATTEMPTS) {
                    throw exception;
                }
                backoff();
            } catch (RestClientException exception) {
                if (attempt == MAX_SUBMIT_ATTEMPTS) {
                    throw exception;
                }
                backoff();
            }
        }
        throw new AdapterUnavailableException("中心采集执行器请求失败");
    }

    private boolean isRetryable(org.springframework.web.client.HttpStatusCodeException exception) {
        var status = exception.getStatusCode().value();
        return status == 408 || status == 429 || status >= 500;
    }

    private void backoff() {
        try {
            Thread.sleep(RETRY_BACKOFF_MILLIS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AdapterUnavailableException("中心采集执行器重试被中断");
        }
    }

    private String normalizeBaseUrl(String value) {
        if (value == null) return "";
        return value.trim().replaceAll("/+$", "");
    }

    static String toSeaTunnelMode(String mode) {
        return "CDC".equalsIgnoreCase(mode) ? "STREAMING" : mode;
    }

    private String safeMessage(Exception exception) {
        if (exception instanceof org.springframework.web.client.HttpStatusCodeException statusException) {
            return "中心采集执行器请求失败（HTTP " + statusException.getStatusCode().value() + "）";
        }
        return "中心采集执行器请求失败";
    }
}
