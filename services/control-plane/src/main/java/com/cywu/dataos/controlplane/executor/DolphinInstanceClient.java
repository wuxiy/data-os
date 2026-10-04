package com.cywu.dataos.controlplane.executor;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * DolphinScheduler 调度实例客户端（G2G 批次 5 第二刀）：工作流实例分页、
 * 任务实例、日志 tail、终止/重跑动作与补数（COMPLEMENT_DATA 区间）。
 * 契约对 DS 3.4.1；只读面（列表/任务/日志）与动作面共用 token 纪律。
 */
@Component
public class DolphinInstanceClient {

    private static final int MAX_MESSAGE_LENGTH = 240;

    private final DolphinHttp http;
    private final String baseUrl;
    private final String configuredTenantCode;
    private final boolean production;

    /** 工作流实例投影：state 保留 DS 原文，归一在服务层做（复用运行适配器口径）。 */
    public record InstanceRecord(long id, String name, String state, Instant startTime,
                                 Instant endTime, Integer runTimes, String host) {
    }

    public record InstancesPage(List<InstanceRecord> items, long total) {
    }

    public record TaskRecord(long id, String name, String state, Instant startTime, Instant endTime) {
    }

    @Autowired
    public DolphinInstanceClient(
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            @Value("${data-os.dolphinscheduler.base-url:}") String baseUrl,
            @Value("${data-os.dolphinscheduler.token:}") String token,
            @Value("${data-os.dolphinscheduler.token-file:}") String tokenFile,
            @Value("${data-os.dolphinscheduler.time-zone:Asia/Shanghai}") String timeZone,
            @Value("${data-os.dolphinscheduler.tenant-code:}") String tenantCode,
            @Value("${data-os.runtime.environment:production}") String environment) {
        this.http = new DolphinHttp(builder, objectMapper, token, tokenFile);
        this.baseUrl = AdapterHttp.normalizeBaseUrl(baseUrl);
        this.configuredTenantCode = tenantCode == null ? "" : tenantCode.trim();
        this.production = "production".equalsIgnoreCase(environment == null ? "" : environment.trim());
    }

    public boolean configured() {
        return !baseUrl.isBlank();
    }

    public InstancesPage instances(long projectCode, long workflowDefinitionCode, String stateType,
                                   int pageNo, int pageSize, String startDate, String endDate) {
        requireConfigured();
        var query = new LinkedMultiValueMap<String, String>();
        query.add("workflowDefinitionCode", String.valueOf(workflowDefinitionCode));
        query.add("pageNo", String.valueOf(pageNo));
        query.add("pageSize", String.valueOf(pageSize));
        if (stateType != null && !stateType.isBlank()) query.add("stateType", stateType);
        if (startDate != null && !startDate.isBlank()) query.add("startDate", startDate);
        if (endDate != null && !endDate.isBlank()) query.add("endDate", endDate);
        try {
            var response = http.get(pathUri(projectCode, "/workflow-instances", query));
            ensureSuccess(response, "实例查询");
            var data = asMap(response == null ? null : response.get("data"));
            if (data == null) return new InstancesPage(List.of(), 0);
            var items = new ArrayList<InstanceRecord>();
            Object list = data.get("totalList");
            if (list == null) list = data.get("list");
            if (list instanceof Iterable<?> entries) {
                for (var entry : entries) {
                    var map = asMap(entry);
                    if (map != null && asLong(map.get("id")) != null) {
                        items.add(toInstance(map));
                    }
                }
            }
            var total = asLong(data.get("total"));
            return new InstancesPage(List.copyOf(items), total == null ? items.size() : total);
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("实例查询", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    public List<TaskRecord> tasks(long projectCode, long instanceId) {
        requireConfigured();
        try {
            var response = http.get(pathUri(projectCode, "/workflow-instances/" + instanceId + "/tasks", null));
            ensureSuccess(response, "任务实例查询");
            var data = response == null ? null : response.get("data");
            var result = new ArrayList<TaskRecord>();
            if (data instanceof Map<?, ?> map) {
                // 3.4 返回 {taskList:[...]}；旧版直接返回数组——两形态都收。
                Object list = map.get("taskList");
                if (list == null) list = map.get("tasks");
                collectTasks(list, result);
            } else {
                collectTasks(data, result);
            }
            return List.copyOf(result);
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("任务实例查询", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    private void collectTasks(Object list, List<TaskRecord> result) {
        if (!(list instanceof Iterable<?> entries)) return;
        for (var entry : entries) {
            var map = asMap(entry);
            if (map == null) continue;
            var id = asLong(map.get("id"));
            if (id == null) continue;
            result.add(new TaskRecord(id,
                    text(map, "name"),
                    text(map, "state"),
                    parseTime(map, "startTime"),
                    parseTime(map, "endTime")));
        }
    }

    /** 日志 tail：skipLineNum=0 + limit 行，只读不落库。 */
    public String taskLog(long taskInstanceId, int limit) {
        requireConfigured();
        var query = new LinkedMultiValueMap<String, String>();
        query.add("taskInstanceId", String.valueOf(taskInstanceId));
        query.add("skipLineNum", "0");
        query.add("limit", String.valueOf(limit));
        try {
            var response = http.get(URI.create(baseUrl + "/log/detail" + toQueryString(query)));
            ensureSuccess(response, "日志查询");
            var data = asMap(response == null ? null : response.get("data"));
            if (data == null) return "";
            var message = data.get("message");
            return message == null ? "" : String.valueOf(message);
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("日志查询", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    /** 实例动作：STOP（终止）/ REPEAT_RUNNING（重跑）等（DS ExecuteType）。 */
    public void execute(long projectCode, long instanceId, String executeType) {
        requireConfigured();
        var query = new LinkedMultiValueMap<String, String>();
        query.add("workflowInstanceId", String.valueOf(instanceId));
        query.add("executeType", executeType);
        try {
            var response = http.post(pathUri(projectCode, "/executors/execute", query), null);
            ensureSuccess(response, "实例" + executeType);
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("实例" + executeType, exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    /** 补数：对绑定工作流按日期区间逐日触发（DS COMPLEMENT_DATA 语义）。 */
    public void backfill(long projectCode, long workflowDefinitionCode, String startTime, String endTime) {
        requireConfigured();
        var query = new LinkedMultiValueMap<String, String>();
        query.add("workflowDefinitionCode", String.valueOf(workflowDefinitionCode));
        query.add("scheduleTime", startTime + "," + endTime);
        query.add("failureStrategy", "CONTINUE");
        query.add("warningType", "NONE");
        query.add("workflowInstancePriority", "MEDIUM");
        query.add("taskDependType", "TASK_POST");
        query.add("execType", "COMPLEMENT_DATA");
        query.add("workerGroup", "default");
        var tenantCode = configuredTenantCode;
        if (tenantCode.isBlank()) {
            throw new AdapterConfigurationException("DolphinScheduler 必须配置命名 tenantCode");
        }
        if (production && "default".equalsIgnoreCase(tenantCode)) {
            throw new AdapterConfigurationException("生产环境禁止使用 DolphinScheduler default tenant");
        }
        query.add("tenantCode", tenantCode);
        query.add("environmentCode", "-1");
        query.add("dryRun", "0");
        try {
            var response = http.post(pathUri(projectCode, "/executors/start-workflow-instance", query), null);
            ensureSuccess(response, "补数提交");
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("补数提交", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    private InstanceRecord toInstance(Map<String, Object> map) {
        var runTimes = asLong(map.get("runTimes"));
        return new InstanceRecord(
                asLong(map.get("id")),
                text(map, "name"),
                text(map, "state"),
                parseTime(map, "startTime"),
                parseTime(map, "endTime"),
                runTimes == null ? null : runTimes.intValue(),
                text(map, "host"));
    }

    private Instant parseTime(Map<String, Object> map, String... keys) {
        for (var key : keys) {
            var parsed = AdapterHttp.parseInstant(map.get(key), java.time.ZoneId.of("Asia/Shanghai"));
            if (parsed != null) return parsed;
        }
        return null;
    }

    private URI pathUri(long projectCode, String path, LinkedMultiValueMap<String, String> query) {
        var builder = UriComponentsBuilder.fromHttpUrl(baseUrl)
                .path("/projects/")
                .pathSegment(String.valueOf(projectCode))
                .path(path);
        if (query != null) query.forEach((key, values) -> values.forEach(value -> builder.queryParam(key, value)));
        return builder.build().encode().toUri();
    }

    private String toQueryString(LinkedMultiValueMap<String, String> query) {
        var builder = UriComponentsBuilder.newInstance();
        query.forEach((key, values) -> values.forEach(value -> builder.queryParam(key, value)));
        var encoded = builder.build().encode();
        return encoded.getQuery() == null ? "" : "?" + encoded.getQuery();
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

    private String text(Map<String, Object> data, String key) {
        var value = data.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private void ensureSuccess(Map<String, Object> response, String action) {
        if (response == null || response.get("code") == null) return;
        Long code = null;
        try {
            code = Long.parseLong(String.valueOf(response.get("code")));
        } catch (NumberFormatException ignored) {
            // 非 numeric code 交由上层分类。
        }
        if (code != null && code != 0) {
            var message = response.get("msg");
            throw new AdapterConfigurationException("DolphinScheduler " + action + "失败："
                    + truncate(message == null ? "返回错误码 " + code : String.valueOf(message)));
        }
    }

    private RuntimeException classifyHttp(String action, HttpClientErrorException exception) {
        var status = exception.getStatusCode().value();
        if (AdapterHttp.isTransient(status) || status == 401 || status == 403) {
            return new AdapterUnavailableException(action + "暂时不可用（HTTP " + status + "）");
        }
        return new AdapterConfigurationException(action + "配置不合法（HTTP " + status + "）："
                + truncate(exception.getResponseBodyAsString()));
    }

    private void requireConfigured() {
        if (baseUrl.isBlank()) {
            throw new AdapterUnavailableException("DolphinScheduler 编排器未配置");
        }
    }

    private String truncate(String value) {
        return value == null ? "" : value.length() > MAX_MESSAGE_LENGTH
                ? value.substring(0, MAX_MESSAGE_LENGTH) : value;
    }
}
