package com.cywu.dataos.controlplane.executor;

import java.net.URI;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * DolphinScheduler 周期调度客户端（G2G 批次 5 第一刀）：schedules API 的
 * 建档/更新/上线/下线/删除/查询/预览。契约对 DS 3.4.1（workflow 命名代，
 * process 别名兜底与运行适配器同款）。调度的唯一事实源在 DS——data-os
 * 不落本地台账，本客户端只做忠实代理。
 */
@Component
public class DolphinScheduleClient {

    private static final String DEFAULT_END_TIME = "2099-12-31 23:59:59";
    private static final int MAX_MESSAGE_LENGTH = 240;

    private final DolphinHttp http;
    private final ObjectMapper objectMapper;
    private final String baseUrl;
    private final ZoneId schedulerZone;
    private final String configuredTenantCode;
    private final boolean production;

    /** DS schedule 实体的忠实投影（时间保持 DS 原文，预览/展示时再归一）。 */
    public record ScheduleRecord(long id, String crontab, String startTime, String endTime,
                                 String timezoneId, boolean online, String warningType,
                                 Instant nextFireTime) {
    }

    @Autowired
    public DolphinScheduleClient(
            RestClient.Builder builder,
            ObjectMapper objectMapper,
            @Value("${data-os.dolphinscheduler.base-url:}") String baseUrl,
            @Value("${data-os.dolphinscheduler.token:}") String token,
            @Value("${data-os.dolphinscheduler.token-file:}") String tokenFile,
            @Value("${data-os.dolphinscheduler.time-zone:Asia/Shanghai}") String timeZone,
            @Value("${data-os.dolphinscheduler.tenant-code:}") String tenantCode,
            @Value("${data-os.runtime.environment:production}") String environment) {
        this.http = new DolphinHttp(builder, objectMapper, token, tokenFile);
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.baseUrl = AdapterHttp.normalizeBaseUrl(baseUrl);
        try {
            this.schedulerZone = ZoneId.of(normalize(timeZone).isBlank()
                    ? "Asia/Shanghai" : normalize(timeZone));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("DolphinScheduler 时区配置不合法", exception);
        }
        this.configuredTenantCode = normalize(tenantCode);
        this.production = "production".equalsIgnoreCase(normalize(environment));
    }

    public boolean configured() {
        return !baseUrl.isBlank();
    }

    /** 查询某工作流当前绑定的调度（DS 每工作流至多一条）。 */
    public ScheduleRecord find(long projectCode, long workflowDefinitionCode) {
        requireConfigured();
        var query = new LinkedMultiValueMap<String, String>();
        query.add("workflowDefinitionCode", String.valueOf(workflowDefinitionCode));
        query.add("pageNo", "1");
        query.add("pageSize", "5");
        try {
            var response = http.get(schedulesUri(projectCode, null, query));
            ensureSuccess(response, "调度查询");
            var data = asMap(response == null ? null : response.get("data"));
            if (data == null) return null;
            Object list = data.getOrDefault("totalList", data.get("list"));
            if (!(list instanceof Collection<?> items) || items.isEmpty()) return null;
            var first = asMap(items.iterator().next());
            return first == null ? null : toRecord(first);
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() == 404) {
                // 老版本路径别名兜底：schedules 资源在部分 3.x 小版本为 process-schedules。
                return findViaProcessPath(projectCode, workflowDefinitionCode);
            }
            throw classifyHttp("调度查询", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    private ScheduleRecord findViaProcessPath(long projectCode, long workflowDefinitionCode) {
        var query = new LinkedMultiValueMap<String, String>();
        query.add("processDefinitionCode", String.valueOf(workflowDefinitionCode));
        query.add("pageNo", "1");
        query.add("pageSize", "5");
        var response = http.get(URI.create(baseUrl + "/projects/" + projectCode
                + "/process-schedules" + toQueryString(query)));
        ensureSuccess(response, "调度查询");
        var data = asMap(response == null ? null : response.get("data"));
        if (data == null) return null;
        Object list = data.getOrDefault("totalList", data.get("list"));
        if (!(list instanceof Collection<?> items) || items.isEmpty()) return null;
        var first = asMap(items.iterator().next());
        return first == null ? null : toRecord(first);
    }

    /** 新建调度（DS 语义：新建后为下线态，须显式上线）。返回调度编号。 */
    public long create(long projectCode, long workflowDefinitionCode, String crontab,
                       String startTime, String endTime, String timezoneId, String warningType) {
        requireConfigured();
        var query = new LinkedMultiValueMap<String, String>();
        query.add("workflowDefinitionCode", String.valueOf(workflowDefinitionCode));
        appendScheduleParams(query, crontab, startTime, endTime, timezoneId, warningType);
        try {
            var response = http.post(schedulesUri(projectCode, null, query), null);
            ensureSuccess(response, "调度创建");
            var id = firstId(response == null ? null : response.get("data"));
            if (id == null) {
                throw new AdapterConfigurationException("DolphinScheduler 未返回调度编号");
            }
            return id;
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("调度创建", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    public void update(long projectCode, long scheduleId, String crontab,
                       String startTime, String endTime, String timezoneId, String warningType) {
        requireConfigured();
        var query = new LinkedMultiValueMap<String, String>();
        appendScheduleParams(query, crontab, startTime, endTime, timezoneId, warningType);
        try {
            var response = http.put(schedulesUri(projectCode, "/" + scheduleId, query), null);
            ensureSuccess(response, "调度更新");
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("调度更新", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    public void online(long projectCode, long scheduleId) {
        switchState(projectCode, scheduleId, "/online", "调度上线");
    }

    public void offline(long projectCode, long scheduleId) {
        switchState(projectCode, scheduleId, "/offline", "调度下线");
    }

    private void switchState(long projectCode, long scheduleId, String action, String label) {
        requireConfigured();
        try {
            var response = http.post(schedulesUri(projectCode, "/" + scheduleId + action, null), null);
            ensureSuccess(response, label);
        } catch (HttpClientErrorException exception) {
            throw classifyHttp(label, exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    public void delete(long projectCode, long scheduleId) {
        requireConfigured();
        try {
            var response = http.delete(schedulesUri(projectCode, "/" + scheduleId, null));
            ensureSuccess(response, "调度删除");
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("调度删除", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    /** 未来 5 次触发时间预览（DS 引擎自身计算）。 */
    public List<Instant> preview(long projectCode, String crontab,
                                 String startTime, String endTime, String timezoneId) {
        requireConfigured();
        var query = new LinkedMultiValueMap<String, String>();
        query.add("schedule", scheduleJson(crontab, startTime, endTime, timezoneId));
        try {
            var response = http.post(schedulesUri(projectCode, "/preview", query), null);
            ensureSuccess(response, "调度预览");
            return parseTimes(response == null ? null : response.get("data"));
        } catch (HttpClientErrorException exception) {
            throw classifyHttp("调度预览", exception);
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("DolphinScheduler 暂时不可用");
        }
    }

    private void appendScheduleParams(LinkedMultiValueMap<String, String> query, String crontab,
                                      String startTime, String endTime, String timezoneId,
                                      String warningType) {
        query.add("schedule", scheduleJson(crontab, startTime, endTime, timezoneId));
        query.add("warningType", isBlank(warningType) ? "NONE" : warningType);
        query.add("warningGroupId", "0");
        query.add("failureStrategy", "CONTINUE");
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
        query.add("workflowInstancePriority", "MEDIUM");
    }

    private String scheduleJson(String crontab, String startTime, String endTime, String timezoneId) {
        var schedule = new HashMap<String, Object>();
        schedule.put("crontab", crontab == null ? "" : crontab.trim());
        schedule.put("startTime", isBlank(startTime)
                ? java.time.LocalDateTime.now(schedulerZone)
                        .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                : startTime.trim());
        schedule.put("endTime", isBlank(endTime) ? DEFAULT_END_TIME : endTime.trim());
        schedule.put("timezoneId", isBlank(timezoneId) ? schedulerZone.getId() : timezoneId.trim());
        try {
            return objectMapper.writeValueAsString(schedule);
        } catch (JsonProcessingException exception) {
            throw new AdapterConfigurationException("DolphinScheduler 调度参数不是有效 JSON");
        }
    }

    private ScheduleRecord toRecord(Map<String, Object> data) {
        var id = asLong(data.get("id"));
        if (id == null) return null;
        var release = AdapterHttp.firstOr(data, "", "releaseState", "state", "status");
        return new ScheduleRecord(
                id,
                text(data, "crontab"),
                text(data, "startTime"),
                text(data, "endTime"),
                text(data, "timezoneId"),
                "ONLINE".equalsIgnoreCase(String.valueOf(release == null ? "" : release)),
                text(data, "warningType"),
                AdapterHttp.parseInstant(data.get("nextFireTime"), schedulerZone));
    }

    private List<Instant> parseTimes(Object data) {
        var result = new ArrayList<Instant>();
        if (data instanceof Collection<?> items) {
            for (var item : items) {
                var parsed = parseTime(item);
                if (parsed != null) result.add(parsed);
            }
        } else if (data != null) {
            var parsed = parseTime(data);
            if (parsed != null) result.add(parsed);
        }
        return result;
    }

    private Instant parseTime(Object value) {
        if (value instanceof Number number) {
            var millis = number.longValue();
            return millis > 10_000_000_000L ? Instant.ofEpochMilli(millis) : Instant.ofEpochSecond(millis);
        }
        return AdapterHttp.parseInstant(value, schedulerZone);
    }

    private URI schedulesUri(long projectCode, String path, LinkedMultiValueMap<String, String> query) {
        var builder = UriComponentsBuilder.fromHttpUrl(baseUrl)
                .path("/projects/")
                .pathSegment(String.valueOf(projectCode))
                .path("/schedules");
        if (path != null) builder.path(path);
        if (query != null) query.forEach((key, values) -> values.forEach(value -> builder.queryParam(key, value)));
        return builder.build().encode().toUri();
    }

    private String toQueryString(LinkedMultiValueMap<String, String> query) {
        var builder = UriComponentsBuilder.newInstance();
        query.forEach((key, values) -> values.forEach(value -> builder.queryParam(key, value)));
        return builder.build().encode().getQuery();
    }

    private Long firstId(Object data) {
        if (data instanceof Collection<?> collection) {
            return collection.stream().map(this::asLong).filter(Objects::nonNull).findFirst().orElse(null);
        }
        if (data instanceof Map<?, ?> map) {
            for (var key : new String[]{"id", "scheduleId"}) {
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
            // 非 numeric code 视为未知，交由上层分类。
        }
        if (code != null && code != 0) {
            var message = response.get("msg");
            throw new AdapterConfigurationException("DolphinScheduler " + action + "失败："
                    + truncate(message == null ? "返回错误码 " + code : String.valueOf(message)));
        }
    }

    /** DS 方言：瞬态与 401/403 归「暂时不可用」，其余归「配置不合法」（与运行适配器一致）。 */
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

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
