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
import java.util.concurrent.atomic.AtomicReference;

import com.cywu.dataos.controlplane.job.IngestionJob;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
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
    private final String token;
    private final String username;
    private final String password;
    private final ZoneId schedulerZone;
    private final AtomicReference<String> sessionId = new AtomicReference<>();

    @Autowired
    public DolphinSchedulerExecutorAdapter(
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            @Value("${data-os.dolphinscheduler.base-url:}") String baseUrl,
            @Value("${data-os.dolphinscheduler.token:}") String token,
            @Value("${data-os.dolphinscheduler.username:}") String username,
            @Value("${data-os.dolphinscheduler.password:}") String password,
            @Value("${data-os.dolphinscheduler.time-zone:Asia/Shanghai}") String timeZone) {
        this(builder, objectMapper, baseUrl, token, username, password, timeZone, true);
    }

    DolphinSchedulerExecutorAdapter(
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            String baseUrl,
            String token,
            String username,
            String password,
            String timeZone,
            boolean ignored) {
        var client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(client);
        requestFactory.setReadTimeout(Duration.ofSeconds(10));
        this.restClient = builder.requestFactory(requestFactory).build();
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.baseUrl = normalizeBaseUrl(baseUrl);
        this.token = normalize(token);
        this.username = normalize(username);
        this.password = password == null ? "" : password.trim();
        try {
            this.schedulerZone = ZoneId.of(normalize(timeZone).isBlank()
                    ? "Asia/Shanghai" : normalize(timeZone));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("DolphinScheduler 时区配置不合法", exception);
        }
    }

    /** Convenience constructor for adapter-level tests and local tools. */
    DolphinSchedulerExecutorAdapter(RestClient.Builder builder, String baseUrl, String token, String timeZone) {
        this(builder, new ObjectMapper(), baseUrl, token, "", "", timeZone, true);
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
        query.add("tenantCode", value(binding, "tenantCode", "default"));
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
            return post(uri, body);
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 401 || username.isBlank() || password.isBlank()) {
                throw exception;
            }
            sessionId.set(null);
            login();
            return post(uri, body);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> post(URI uri, Object body) {
        var request = restClient.post().uri(uri).headers(this::applyAuth).contentType(MediaType.APPLICATION_JSON);
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
            return restClient.get().uri(uri).headers(this::applyAuth).retrieve().body(Map.class);
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 401 || username.isBlank() || password.isBlank()) {
                throw exception;
            }
            sessionId.set(null);
            login();
            return restClient.get().uri(uri).headers(this::applyAuth).retrieve().body(Map.class);
        }
    }

    private void applyAuth(HttpHeaders headers) {
        if (!token.isBlank()) {
            headers.set("token", token);
            return;
        }
        if (sessionId.get() == null) login();
        var current = sessionId.get();
        if (current == null || current.isBlank()) {
            throw new AdapterUnavailableException("DolphinScheduler 未配置访问凭据");
        }
        headers.set(HttpHeaders.COOKIE, "sessionId=" + current);
    }

    @SuppressWarnings("unchecked")
    private synchronized void login() {
        if (sessionId.get() != null) return;
        if (username.isBlank() || password.isBlank()) {
            throw new AdapterUnavailableException("DolphinScheduler 未配置访问凭据");
        }
        var form = new LinkedMultiValueMap<String, String>();
        form.add("userName", username);
        form.add("userPassword", password);
        try {
            ResponseEntity<Map> response = restClient.post()
                    .uri(baseUrl + "/login")
                    .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                    .body(form)
                    .retrieve()
                    .toEntity(Map.class);
            var cookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
            var parsed = parseCookie(cookie);
            if (parsed == null) {
                throw new AdapterUnavailableException("DolphinScheduler 登录未返回会话");
            }
            sessionId.set(parsed);
        } catch (HttpClientErrorException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 登录失败");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 登录暂时不可用");
        }
    }

    private String parseCookie(String setCookie) {
        if (setCookie == null) return null;
        for (var part : setCookie.split(";")) {
            var pair = part.trim().split("=", 2);
            if (pair.length == 2 && "sessionId".equals(pair[0]) && !pair[1].isBlank()) return pair[1];
        }
        return null;
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
