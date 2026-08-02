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
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Component
public class SeaTunnelExecutorAdapter implements ExecutorAdapter {

    private final RestClient restClient;
    private final String baseUrl;

    public SeaTunnelExecutorAdapter(RestClient.Builder builder,
                                    @Value("${data-os.seatunnel.base-url:}") String baseUrl) {
        var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(client);
        requestFactory.setReadTimeout(Duration.ofSeconds(10));
        this.restClient = builder.requestFactory(requestFactory).build();
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
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
        env.putIfAbsent("job.mode", job.mode());
        config.put("env", env);

        try {
            var response = restClient.post()
                    .uri(baseUrl + "/submit-job")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(config)
                    .retrieve()
                    .body(Map.class);
            var externalId = response == null || response.get("jobId") == null
                    ? null : String.valueOf(response.get("jobId"));
            return new AdapterSubmission(externalId, "中心采集执行器已接受提交");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException(safeMessage(exception));
        }
    }

    private String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) return "中心采集执行器请求失败";
        return message.length() > 240 ? message.substring(0, 240) : message;
    }
}
