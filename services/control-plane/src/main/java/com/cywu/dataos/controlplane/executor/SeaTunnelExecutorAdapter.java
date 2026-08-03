package com.cywu.dataos.controlplane.executor;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.Locale;
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
    private static final DateTimeFormatter SEATUNNEL_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final RestClient restClient;
    private final String baseUrl;
    private final ZoneId seatunnelZone;

    public SeaTunnelExecutorAdapter(RestClient.Builder builder,
                                    @Value("${data-os.seatunnel.base-url:}") String baseUrl,
                                    @Value("${data-os.seatunnel.time-zone:UTC}") String timeZone) {
        var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(client);
        requestFactory.setReadTimeout(Duration.ofSeconds(10));
        this.restClient = builder.requestFactory(requestFactory).build();
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.seatunnelZone = ZoneId.of(timeZone);
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

    @Override
    @SuppressWarnings("unchecked")
    public AdapterRunStatus status(String externalId) {
        if (baseUrl.isBlank()) {
            throw new AdapterUnavailableException("中心采集执行器未配置");
        }
        if (externalId == null || externalId.isBlank()) {
            throw new AdapterConfigurationException("缺少中心采集外部作业 ID");
        }

        try {
            var response = restClient.get()
                    .uri(baseUrl + "/job-info/{jobId}", externalId)
                    .retrieve()
                    .body(Map.class);
            var externalStatus = response == null || response.get("jobStatus") == null
                    ? "UNKNOWN" : String.valueOf(response.get("jobStatus"));
            var status = normalizeStatus(externalStatus);
            var message = statusMessage(status, response == null ? null : response.get("errorMsg"));
            return new AdapterRunStatus(status, message,
                    parseTime(response, "startTime"),
                    parseTime(response, "finishTime", "finishedTime"));
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() == 404) {
                return new AdapterRunStatus("UNKNOWN", "中心采集作业暂未找到，请人工重试", null, null);
            }
            if (isRetryable(exception)) {
                throw new AdapterUnavailableException("中心采集执行器暂时不可用（HTTP "
                        + exception.getStatusCode().value() + "）");
            }
            throw new AdapterConfigurationException("中心采集状态查询不合法（HTTP "
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

    static String normalizeStatus(String status) {
        if (status == null) return "UNKNOWN";
        return switch (status.trim().toUpperCase(Locale.ROOT)) {
            case "SUBMITTED", "CREATED", "SCHEDULED", "PENDING" -> "SUBMITTED";
            case "INITIALIZING", "RUNNING" -> "RUNNING";
            case "FINISHED", "SUCCESS", "SUCCEEDED" -> "SUCCEEDED";
            case "FAILED", "ERROR" -> "FAILED";
            case "CANCELED", "CANCELLED", "STOPPED" -> "CANCELED";
            default -> "UNKNOWN";
        };
    }

    private String statusMessage(String status, Object errorMessage) {
        if ("FAILED".equals(status) && errorMessage != null && !String.valueOf(errorMessage).isBlank()) {
            var message = String.valueOf(errorMessage).replaceAll("(?i)seatunnel", "中心采集");
            return "中心采集作业失败：" + (message.length() > 240 ? message.substring(0, 240) : message);
        }
        return switch (status) {
            case "SUBMITTED" -> "中心采集作业已提交，等待执行";
            case "RUNNING" -> "中心采集作业执行中";
            case "SUCCEEDED" -> "中心采集作业已完成";
            case "FAILED" -> "中心采集作业失败";
            case "CANCELED" -> "中心采集作业已取消";
            default -> "中心采集作业状态待确认";
        };
    }

    private Instant parseTime(Map<String, Object> response, String... keys) {
        Object value = null;
        if (response != null) {
            for (String key : keys) {
                if (response.get(key) != null && !String.valueOf(response.get(key)).isBlank()) {
                    value = response.get(key);
                    break;
                }
            }
        }
        if (value == null || String.valueOf(value).isBlank()) return null;
        var text = String.valueOf(value);
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException ignored) {
            try {
                return LocalDateTime.parse(text, SEATUNNEL_TIME)
                        .atZone(seatunnelZone).toInstant();
            } catch (DateTimeParseException ignoredAgain) {
                return null;
            }
        }
    }

    private String safeMessage(Exception exception) {
        if (exception instanceof org.springframework.web.client.HttpStatusCodeException statusException) {
            return "中心采集执行器请求失败（HTTP " + statusException.getStatusCode().value() + "）";
        }
        return "中心采集执行器请求失败";
    }
}
