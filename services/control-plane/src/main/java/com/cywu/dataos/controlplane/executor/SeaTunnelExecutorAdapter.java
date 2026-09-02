package com.cywu.dataos.controlplane.executor;

import com.cywu.dataos.controlplane.api.ErrorMessages;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Collection;
import java.util.Locale;
import java.util.Map;

import com.cywu.dataos.controlplane.job.IngestionJob;
import com.cywu.dataos.controlplane.job.JobConfigTree;
import com.cywu.dataos.controlplane.credential.CredentialResolver;
import com.cywu.dataos.controlplane.security.AuthProperties;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.cywu.dataos.controlplane.source.SourceNetworkPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
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
    private final ZoneId seatunnelZone;
    private final CredentialResolver credentialResolver;
    private final TenantScope tenantScope;
    private final SourceNetworkPolicy sourceNetworkPolicy;

    @org.springframework.beans.factory.annotation.Autowired
    public SeaTunnelExecutorAdapter(RestClient.Builder builder,
                                    @Value("${data-os.seatunnel.base-url:}") String baseUrl,
                                    @Value("${data-os.seatunnel.time-zone:UTC}") String timeZone,
                                    CredentialResolver credentialResolver, TenantScope tenantScope,
                                    SourceNetworkPolicy sourceNetworkPolicy) {
        this.restClient = AdapterHttp.restClient(builder, Duration.ofSeconds(3), Duration.ofSeconds(10));
        this.baseUrl = AdapterHttp.normalizeBaseUrl(baseUrl);
        this.seatunnelZone = ZoneId.of(timeZone);
        this.credentialResolver = credentialResolver;
        this.tenantScope = tenantScope;
        this.sourceNetworkPolicy = sourceNetworkPolicy;
    }

    /** Compatibility constructor retained for adapter-level tests. */
    SeaTunnelExecutorAdapter(RestClient.Builder builder, String baseUrl, String timeZone,
                              CredentialResolver credentialResolver, TenantScope tenantScope) {
        this(builder, baseUrl, timeZone, credentialResolver, tenantScope,
                SourceNetworkPolicy.developmentDefaults());
    }

    /** Convenience constructor retained for adapter-level tests. */
    SeaTunnelExecutorAdapter(RestClient.Builder builder, String baseUrl, String timeZone) {
        this(builder, baseUrl, timeZone,
                (reference, tenantId, institutionId) -> Map.of(),
                new TenantScope(new AuthProperties()));
    }

    @Override
    public boolean supports(String executor) {
        return "SEATUNNEL".equalsIgnoreCase(executor);
    }

    @Override
    public AdapterSubmission submit(IngestionJob job, Map<String, Object> requestConfig) {
        return submit(job, requestConfig, null);
    }

    @Override
    public AdapterSubmission submit(IngestionJob job, Map<String, Object> requestConfig, String dataOsRunId) {
        if (baseUrl.isBlank()) {
            throw new AdapterUnavailableException("中心采集执行器未配置");
        }
        if (requestConfig.isEmpty()) {
            throw new AdapterConfigurationException("未提供中心采集作业配置");
        }

        var scope = tenantScope.current();
        Map<String, Object> config;
        try {
            config = JobConfigTree.resolveCredentials(requestConfig, credentialResolver,
                    scope.tenantId(), scope.institutionId());
        } catch (IllegalStateException exception) {
            throw new AdapterConfigurationException("中心采集作业 credentialRef 无法解析");
        }
        var env = new HashMap<String, Object>();
        if (config.get("env") instanceof Map<?, ?> existingEnv) {
            existingEnv.forEach((key, value) -> env.put(String.valueOf(key), value));
        }
        env.putIfAbsent("job.name", job.name());
        var requestedMode = env.get("job.mode");
        env.put("job.mode", toSeaTunnelMode(requestedMode == null ? job.mode() : String.valueOf(requestedMode)));
        if (dataOsRunId != null && !dataOsRunId.isBlank()) {
            env.put("dataos_run_id", dataOsRunId);
        }
        config.put("env", env);
        validateExecutionConfig(config);

        try {
            var response = submitWithRetry(config, dataOsRunId);
            var externalId = response == null || response.get("jobId") == null
                    ? null : String.valueOf(response.get("jobId"));
            return new AdapterSubmission(externalId, "中心采集执行器已接受提交");
        } catch (HttpClientErrorException exception) {
            if (AdapterHttp.isTransient(exception.getStatusCode().value())) {
                throw new AdapterUnavailableException("中心采集执行器暂时不可用（HTTP "
                        + exception.getStatusCode().value() + "）");
            }
            throw new AdapterConfigurationException("中心采集作业配置不合法（HTTP "
                    + exception.getStatusCode().value() + "）");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException(ErrorMessages.safe(exception));
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
            if (AdapterHttp.isTransient(exception.getStatusCode().value())) {
                throw new AdapterUnavailableException("中心采集执行器暂时不可用（HTTP "
                        + exception.getStatusCode().value() + "）");
            }
            throw new AdapterConfigurationException("中心采集状态查询不合法（HTTP "
                    + exception.getStatusCode().value() + "）");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException(ErrorMessages.safe(exception));
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public AdapterReconciliation reconcile(String dataOsRunId) {
        if (baseUrl.isBlank()) {
            return AdapterReconciliation.manualRequired("中心采集执行器未配置，无法按 data_os_run_id 对账，请人工确认");
        }
        if (dataOsRunId == null || dataOsRunId.isBlank()) {
            return AdapterReconciliation.manualRequired("缺少 data_os_run_id，无法对账");
        }
        try {
            var response = restClient.get()
                    .uri(baseUrl + "/job-info?dataos_run_id={runId}", dataOsRunId)
                    .retrieve().body(Map.class);
            if (response == null || response.get("jobId") == null
                    || String.valueOf(response.get("jobId")).isBlank()) {
                return AdapterReconciliation.notFound("中心采集执行器未找到该 data_os_run_id");
            }
            var externalId = String.valueOf(response.get("jobId"));
            var externalStatus = response.get("jobStatus") == null
                    ? "UNKNOWN" : String.valueOf(response.get("jobStatus"));
            var status = normalizeStatus(externalStatus);
            return AdapterReconciliation.found(externalId,
                    new AdapterRunStatus(status, statusMessage(status, response.get("errorMsg")),
                            parseTime(response, "startTime"), parseTime(response, "finishTime", "finishedTime")),
                    "已按 data_os_run_id 找到中心采集作业");
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() == 404) {
                return AdapterReconciliation.notFound("中心采集执行器未找到该 data_os_run_id");
            }
            if (AdapterHttp.isTransient(exception.getStatusCode().value())) {
                throw new AdapterUnavailableException("中心采集执行器暂时不可用（HTTP "
                        + exception.getStatusCode().value() + "）");
            }
            throw new AdapterConfigurationException("中心采集对账请求不合法（HTTP "
                    + exception.getStatusCode().value() + "）");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException(ErrorMessages.safe(exception));
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> submitWithRetry(Map<String, Object> config, String dataOsRunId) {
        for (var attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
            try {
                var request = restClient.post()
                        .uri(baseUrl + "/submit-job")
                        .contentType(MediaType.APPLICATION_JSON);
                if (dataOsRunId != null && !dataOsRunId.isBlank()) {
                    request = request.header("X-Data-OS-Run-Id", dataOsRunId);
                }
                return request.body(config).retrieve().body(Map.class);
            } catch (HttpClientErrorException | HttpServerErrorException exception) {
                if (!AdapterHttp.isTransient(exception.getStatusCode().value()) || attempt == MAX_SUBMIT_ATTEMPTS) {
                    if (AdapterHttp.isTransient(exception.getStatusCode().value())) {
                        throw new AdapterSubmissionUnknownException("中心采集提交结果未知（HTTP "
                                + exception.getStatusCode().value() + "），需按 data_os_run_id 对账");
                    }
                    throw exception;
                }
                backoff();
            } catch (RestClientException exception) {
                if (attempt == MAX_SUBMIT_ATTEMPTS) {
                    throw new AdapterSubmissionUnknownException("中心采集提交结果未知：" + ErrorMessages.safe(exception));
                }
                backoff();
            }
        }
        throw new AdapterUnavailableException("中心采集执行器请求失败");
    }

    @SuppressWarnings("unchecked")
    private void validateExecutionConfig(Map<String, Object> config) {
        validatePluginEndpoints(config.get("source"));
        validatePluginEndpoints(config.get("sink"));
    }

    private void validatePluginEndpoints(Object plugins) {
        if (!(plugins instanceof Collection<?> collection)) return;
        for (var item : collection) {
            if (!(item instanceof Map<?, ?> plugin)) continue;
            var name = String.valueOf(plugin.get("plugin_name") == null ? "" : plugin.get("plugin_name"))
                    .toLowerCase(Locale.ROOT);
            var url = plugin.get("url");
            if (url != null && !String.valueOf(url).isBlank()) {
                if (name.contains("jdbc")) sourceNetworkPolicy.validateJdbcUrl(String.valueOf(url));
                else if (name.contains("http") || name.contains("rest")) {
                    sourceNetworkPolicy.validateHttpUrl(String.valueOf(url));
                }
            }
            var fenodes = plugin.get("fenodes");
            if (fenodes != null) {
                for (var node : String.valueOf(fenodes).split(",")) {
                    if (!node.isBlank()) sourceNetworkPolicy.validateHostPort(node);
                }
            }
        }
    }

    private void backoff() {
        try {
            Thread.sleep(RETRY_BACKOFF_MILLIS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AdapterUnavailableException("中心采集执行器重试被中断");
        }
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
        // SeaTunnel 语义：取第一个非空字段解析一次，坏时间戳不失败状态轮询。
        if (response == null) return null;
        for (String key : keys) {
            var value = response.get(key);
            if (value != null && !String.valueOf(value).isBlank()) {
                return AdapterHttp.parseInstant(value, seatunnelZone);
            }
        }
        return null;
    }
}
