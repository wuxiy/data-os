package com.cywu.dataos.controlplane.executor;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Collection;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

import com.cywu.dataos.controlplane.job.IngestionJob;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Delegates a data-os run to an already published DolphinScheduler workflow.
 *
 * <p>Gate 1 deliberately uses a pre-published workflow binding instead of
 * creating workflow definitions on every run.  The binding lives in the job
 * configuration under {@code dolphinscheduler}; credentials remain runtime
 * configuration and are never accepted from that JSON.</p>
 */
@Component
public class DolphinSchedulerExecutorAdapter implements OrchestratorAdapter {

    private static final String EXTERNAL_ID_PREFIX = "ds|";
    private static final DateTimeFormatter SCHEDULE_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final DateTimeFormatter LOCAL_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final int MAX_MESSAGE_LENGTH = 240;

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final String baseUrl;
    private final SchedulerTokenProvider tokenProvider;
    private final ZoneId schedulerZone;
    private final String configuredTenantCode;
    private final boolean production;

    private record RuntimeContext(String tenantCode, String environment) {
    }

    @Autowired
    public DolphinSchedulerExecutorAdapter(
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            @Value("${data-os.dolphinscheduler.base-url:}") String baseUrl,
            @Value("${data-os.dolphinscheduler.token:}") String token,
            @Value("${data-os.dolphinscheduler.token-file:}") String tokenFile,
            @Value("${data-os.dolphinscheduler.username:}") String username,
            @Value("${data-os.dolphinscheduler.password:}") String password,
            @Value("${data-os.dolphinscheduler.time-zone:Asia/Shanghai}") String timeZone,
            @Value("${data-os.dolphinscheduler.tenant-code:}") String tenantCode,
            @Value("${data-os.runtime.environment:production}") String environment) {
        this(builder, objectMapper, baseUrl, token, tokenFile, username, password, timeZone,
                new RuntimeContext(tenantCode, environment));
    }

    private DolphinSchedulerExecutorAdapter(
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            String baseUrl,
            String token,
            String tokenFile,
            String username,
            String password,
            String timeZone,
            RuntimeContext runtimeContext) {
        // DolphinScheduler's internal API is normally plain HTTP.  Pin the
        // client to HTTP/1.1 so a JDK h2c upgrade cannot be rejected by its
        // embedded HTTP server in the same way as the quality Runtime.
        var client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(client);
        requestFactory.setReadTimeout(Duration.ofSeconds(10));
        this.restClient = builder.requestFactory(requestFactory).build();
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.tokenProvider = new SchedulerTokenProvider(objectMapper, token, tokenFile);
        try {
            this.schedulerZone = ZoneId.of(normalize(timeZone).isBlank()
                    ? "Asia/Shanghai" : normalize(timeZone));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("DolphinScheduler 时区配置不合法", exception);
        }
        this.configuredTenantCode = normalize(runtimeContext.tenantCode());
        this.production = "production".equalsIgnoreCase(normalize(runtimeContext.environment()));
    }

    /** Convenience constructor for adapter-level tests and local tools. */
    DolphinSchedulerExecutorAdapter(RestClient.Builder builder, String baseUrl, String token, String timeZone) {
        this(builder, new ObjectMapper(), baseUrl, token, "", "", "", timeZone,
                new RuntimeContext("dataos-dev", "development"));
    }

    static DolphinSchedulerExecutorAdapter forTesting(
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            String baseUrl,
            String token,
            String username,
            String password,
            String timeZone,
            String tenantCode,
            String environment) {
        return new DolphinSchedulerExecutorAdapter(
                builder, objectMapper, baseUrl, token, "", username, password, timeZone,
                new RuntimeContext(tenantCode, environment));
    }

    @Override
    public boolean supports(String executor) {
        return "DOLPHINSCHEDULER".equalsIgnoreCase(executor)
                || "DOLPHIN_SCHEDULER".equalsIgnoreCase(executor);
    }

    @Override
    public AdapterSubmission submit(IngestionJob job, Map<String, Object> requestConfig) {
        return submit(job, requestConfig, null);
    }

    @Override
    public AdapterSubmission submit(IngestionJob job, Map<String, Object> requestConfig, String dataOsRunId) {
        if (baseUrl.isBlank()) {
            throw new AdapterUnavailableException("DolphinScheduler 编排器未配置");
        }
        var binding = workflowBinding(requestConfig);
        var projectCode = requiredLong(binding, "projectCode", "项目编号");
        var workflowCode = requiredLong(binding, "workflowDefinitionCode", "工作流定义编号");
        var scheduleTime = LocalDateTime.now(schedulerZone).format(SCHEDULE_TIME);
        var query = new LinkedMultiValueMap<String, String>();
        query.add("workflowDefinitionCode", String.valueOf(workflowCode));
        query.add("scheduleTime", scheduleTime + "," + scheduleTime);
        query.add("failureStrategy", value(binding, "failureStrategy", "CONTINUE"));
        query.add("warningType", value(binding, "warningType", "NONE"));
        query.add("workflowInstancePriority", value(binding, "workflowInstancePriority", "MEDIUM"));
        query.add("taskDependType", value(binding, "taskDependType", "TASK_POST"));
        query.add("execType", value(binding, "execType", "START_PROCESS"));
        query.add("workerGroup", value(binding, "workerGroup", "default"));
        var tenantCode = value(binding, "tenantCode", configuredTenantCode);
        if (tenantCode.isBlank()) {
            throw new AdapterConfigurationException("DolphinScheduler 必须配置命名 tenantCode");
        }
        if (!configuredTenantCode.isBlank() && !configuredTenantCode.equals(tenantCode)) {
            throw new AdapterConfigurationException("DolphinScheduler tenantCode 必须与运行环境配置一致");
        }
        if (production && "default".equalsIgnoreCase(tenantCode)) {
            throw new AdapterConfigurationException("生产环境禁止使用 DolphinScheduler default tenant");
        }
        query.add("tenantCode", tenantCode);
        query.add("environmentCode", value(binding, "environmentCode", "-1"));
        query.add("dryRun", value(binding, "dryRun", "0"));
        if (binding.containsKey("startNodeList")) {
            query.add("startNodeList", String.valueOf(binding.get("startNodeList")));
        }
        if (binding.containsKey("startParams") || dataOsRunId != null) {
            var startParams = new HashMap<String, Object>();
            if (binding.get("startParams") instanceof Map<?, ?> configuredStartParams) {
                configuredStartParams.forEach((key, value) -> startParams.put(String.valueOf(key), value));
            } else if (binding.containsKey("startParams")) {
                throw new AdapterConfigurationException("DolphinScheduler startParams 必须是对象");
            }
            if (dataOsRunId != null && !dataOsRunId.isBlank()) {
                startParams.putIfAbsent("dataos_run_id", dataOsRunId);
            }
            query.add("startParams", json(startParams));
        }

        try {
            var response = postWithAuth(
                    workflowUri(projectCode, "/executors/start-workflow-instance", query),
                    null);
            ensureSuccess(response, "工作流提交");
            var instanceId = firstId(response == null ? null : response.get("data"));
            if (instanceId == null) {
                throw new AdapterConfigurationException("DolphinScheduler 未返回工作流实例编号");
            }
            return new AdapterSubmission(
                    encodeExternalId(projectCode, workflowCode, instanceId),
                    "DolphinScheduler 已接受工作流运行");
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("DolphinScheduler 工作流提交", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    @Override
    public AdapterRunStatus status(String externalId) {
        if (baseUrl.isBlank()) {
            throw new AdapterUnavailableException("DolphinScheduler 编排器未配置");
        }
        var reference = decodeExternalId(externalId);
        try {
            var response = getWorkflow(reference.projectCode(), reference.instanceId());
            if (response == null) {
                return new AdapterRunStatus("UNKNOWN", "DolphinScheduler 工作流实例暂未找到，请人工重试", null, null);
            }
            ensureSuccess(response, "状态查询");
            var data = asMap(response.get("data"));
            if (data == null) {
                return new AdapterRunStatus("UNKNOWN", "DolphinScheduler 未返回工作流状态", null, null);
            }
            var normalized = normalizeStatus(firstValue(data, "state", "status", "workflowInstanceState"));
            return new AdapterRunStatus(normalized, statusMessage(normalized, data.get("failureReason")),
                    parseTime(data, "startTime", "scheduleTime"),
                    parseTime(data, "endTime", "finishTime", "updateTime"));
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() == 404) {
                return new AdapterRunStatus("UNKNOWN", "DolphinScheduler 工作流实例暂未找到，请人工重试", null, null);
            }
            throw classifyHttp("DolphinScheduler 状态查询", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    private Map<String, Object> workflowBinding(Map<String, Object> requestConfig) {
        if (requestConfig == null || requestConfig.isEmpty()) {
            throw new AdapterConfigurationException("未提供 DolphinScheduler 工作流绑定配置");
        }
        Object configured = requestConfig.get("dolphinscheduler");
        if (!(configured instanceof Map<?, ?>)) {
            configured = requestConfig.get("orchestrator");
        }
        if (!(configured instanceof Map<?, ?> map)) {
            throw new AdapterConfigurationException("缺少 dolphinscheduler 工作流绑定配置");
        }
        var binding = new HashMap<String, Object>();
        map.forEach((key, value) -> binding.put(String.valueOf(key), value));
        return binding;
    }

    private long requiredLong(Map<String, Object> binding, String key, String label) {
        var value = binding.get(key);
        if (value == null || String.valueOf(value).isBlank()) {
            throw new AdapterConfigurationException("DolphinScheduler 缺少" + label);
        }
        try {
            var result = Long.parseLong(String.valueOf(value));
            if (result <= 0) throw new NumberFormatException();
            return result;
        } catch (NumberFormatException exception) {
            throw new AdapterConfigurationException("DolphinScheduler " + label + "必须是正整数");
        }
    }

    private String value(Map<String, Object> binding, String key, String fallback) {
        var value = binding.get(key);
        return value == null || String.valueOf(value).isBlank() ? fallback : String.valueOf(value);
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new AdapterConfigurationException("DolphinScheduler startParams 不是有效 JSON");
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> postWithAuth(URI uri, Object body) {
        try {
            return post(uri, body, tokenProvider.snapshot().current());
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 401) {
                throw exception;
            }
            var previous = tokenProvider.snapshot().previous();
            if (previous.isBlank()) throw new AdapterUnavailableException("DolphinScheduler Token 已失效");
            return post(uri, body, previous);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> post(URI uri, Object body, String tokenOverride) {
        var request = restClient.post().uri(uri).headers(headers -> applyAuth(headers, tokenOverride))
                .contentType(MediaType.APPLICATION_JSON);
        return body == null ? request.retrieve().body(Map.class) : request.body(body).retrieve().body(Map.class);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getWorkflow(long projectCode, long instanceId) {
        try {
            return get(workflowUri(projectCode, "/workflow-instances/" + instanceId, null));
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 404) throw exception;
            // Older DS 3.x installations expose the same resource as process-instances.
            return get(workflowUri(projectCode, "/process-instances/" + instanceId, null));
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> get(URI uri) {
        try {
            return restClient.get().uri(uri).headers(headers -> applyAuth(headers, tokenProvider.snapshot().current()))
                    .retrieve().body(Map.class);
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 401) {
                throw exception;
            }
            var previous = tokenProvider.snapshot().previous();
            if (previous.isBlank()) throw new AdapterUnavailableException("DolphinScheduler Token 已失效");
            return restClient.get().uri(uri).headers(headers -> applyAuth(headers, previous))
                    .retrieve().body(Map.class);
        }
    }

    private void applyAuth(HttpHeaders headers, String token) {
        if (token == null || token.isBlank()) {
            throw new AdapterUnavailableException("DolphinScheduler 未配置访问凭据");
        }
        headers.set("token", token);
    }

    private URI workflowUri(long projectCode, String path, LinkedMultiValueMap<String, String> query) {
        var builder = UriComponentsBuilder.fromHttpUrl(baseUrl)
                .path("/projects/")
                .pathSegment(String.valueOf(projectCode))
                .path(path);
        if (query != null) query.forEach((key, values) -> values.forEach(value -> builder.queryParam(key, value)));
        return builder.build().encode().toUri();
    }

    private Long firstId(Object data) {
        if (data instanceof Collection<?> collection) {
            return collection.stream().map(this::asLong).filter(Objects::nonNull).findFirst().orElse(null);
        }
        if (data instanceof Map<?, ?> map) {
            // The current API returns workflow instance IDs. A trigger code is
            // not an instance ID and must never be persisted as one.
            for (var key : new String[]{"id", "workflowInstanceId", "processInstanceId"}) {
                var value = asLong(map.get(key));
                if (value != null) return value;
            }
        }
        return asLong(data);
    }

    private Long asLong(Object value) {
        if (value == null) return null;
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> asMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) return null;
        var result = new HashMap<String, Object>();
        map.forEach((key, item) -> result.put(String.valueOf(key), item));
        return result;
    }

    private String firstValue(Map<String, Object> map, String... keys) {
        for (var key : keys) {
            var value = map.get(key);
            if (value != null && !String.valueOf(value).isBlank()) return String.valueOf(value);
        }
        return "UNKNOWN";
    }

    static String encodeExternalId(long projectCode, long workflowCode, long instanceId) {
        return EXTERNAL_ID_PREFIX + projectCode + "|" + workflowCode + "|" + instanceId;
    }

    private Reference decodeExternalId(String externalId) {
        if (externalId == null || externalId.isBlank()) {
            throw new AdapterConfigurationException("缺少 DolphinScheduler 工作流实例编号");
        }
        var parts = externalId.split("\\|", -1);
        if (parts.length != 4 || !"ds".equals(parts[0])) {
            throw new AdapterConfigurationException("DolphinScheduler 外部运行编号格式不合法");
        }
        try {
            var project = Long.parseLong(parts[1]);
            var workflow = Long.parseLong(parts[2]);
            var instance = Long.parseLong(parts[3]);
            if (project <= 0 || workflow <= 0 || instance <= 0) throw new NumberFormatException();
            return new Reference(project, workflow, instance);
        } catch (NumberFormatException exception) {
            throw new AdapterConfigurationException("DolphinScheduler 外部运行编号格式不合法");
        }
    }

    static String normalizeStatus(String state) {
        if (state == null) return "UNKNOWN";
        return switch (state.trim().toUpperCase(Locale.ROOT)) {
            case "SUBMITTED_SUCCESS", "SERIAL_WAIT", "DISPATCH" -> "SUBMITTED";
            case "RUNNING_EXECUTION", "READY_PAUSE", "PAUSE", "READY_STOP", "WAITING_THREAD",
                    "WAITING_DEPEND", "DELAY_EXECUTION", "WAITING_RESOURCES", "WAITING_QUEUE" -> "RUNNING";
            case "SUCCESS" -> "SUCCEEDED";
            case "FAILURE", "NEED_FAULT_TOLERANCE" -> "FAILED";
            case "STOP", "KILL", "CANCEL", "CANCELED", "CANCELLED" -> "CANCELED";
            default -> "UNKNOWN";
        };
    }

    private String statusMessage(String status, Object failureReason) {
        if ("FAILED".equals(status) && failureReason != null && !String.valueOf(failureReason).isBlank()) {
            return "DolphinScheduler 工作流失败：" + truncate(String.valueOf(failureReason));
        }
        return switch (status) {
            case "SUBMITTED" -> "DolphinScheduler 工作流已提交，等待执行";
            case "RUNNING" -> "DolphinScheduler 工作流执行中";
            case "SUCCEEDED" -> "DolphinScheduler 工作流已完成";
            case "FAILED" -> "DolphinScheduler 工作流失败";
            case "CANCELED" -> "DolphinScheduler 工作流已取消";
            default -> "DolphinScheduler 工作流状态待确认";
        };
    }

    private void ensureSuccess(Map<String, Object> response, String action) {
        if (response == null || response.get("code") == null) return;
        var code = asLong(response.get("code"));
        if (code != null && code != 0) {
            var message = response.get("msg");
            throw new AdapterConfigurationException("DolphinScheduler " + action + "失败："
                    + truncate(message == null ? "返回错误码 " + code : String.valueOf(message)));
        }
    }

    private Instant parseTime(Map<String, Object> data, String... keys) {
        for (var key : keys) {
            var value = data.get(key);
            if (value == null || String.valueOf(value).isBlank()) continue;
            var text = String.valueOf(value);
            try {
                return Instant.parse(text);
            } catch (DateTimeParseException ignored) {
                try {
                    return LocalDateTime.parse(text, LOCAL_TIME).atZone(schedulerZone).toInstant();
                } catch (DateTimeParseException ignoredAgain) {
                    // Try the next field; malformed vendor timestamps must not fail the status poll.
                }
            }
        }
        return null;
    }

    private RuntimeException classifyHttp(String action, HttpClientErrorException exception) {
        var status = exception.getStatusCode().value();
        if (status == 401 || status == 403 || status == 408 || status == 429 || status >= 500) {
            return new AdapterUnavailableException(action + "暂时不可用（HTTP " + status + "）");
        }
        return new AdapterConfigurationException(action + "配置不合法（HTTP " + status + "）");
    }

    private String truncate(String value) {
        return value.length() > MAX_MESSAGE_LENGTH ? value.substring(0, MAX_MESSAGE_LENGTH) : value;
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }

    private String normalizeBaseUrl(String value) {
        return normalize(value).replaceAll("/+$", "");
    }

    private record Reference(long projectCode, long workflowCode, long instanceId) {
    }
}
