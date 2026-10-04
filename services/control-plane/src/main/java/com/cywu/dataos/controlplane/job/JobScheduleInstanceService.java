package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.DolphinInstanceClient;
import com.cywu.dataos.controlplane.executor.DolphinSchedulerExecutorAdapter;

/**
 * 调度实例面（G2G 批次 5 第二刀）：DS 定时触发与补数产生的实例不进
 * control-plane run 表，以 DS 为唯一事实源实时代理——列表/任务/日志只读，
 * 终止/重跑/补数为动作面。通道守卫复用调度域（仅 DS 任务）。
 */
@Service
public class JobScheduleInstanceService {

    private static final Pattern STATE_FILTER = Pattern.compile("^[A-Z_]{1,32}$");
    private static final DateTimeFormatter DS_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final int MAX_BACKFILL_DAYS = 31;
    private static final int MAX_LOG_LINES = 1000;

    private final JobScheduleService scheduleService;
    private final DolphinInstanceClient client;

    public JobScheduleInstanceService(JobScheduleService scheduleService,
                                      DolphinInstanceClient client,
                                      @Value("${data-os.dolphinscheduler.time-zone:Asia/Shanghai}") String timeZone) {
        this.scheduleService = scheduleService;
        this.client = client;
    }

    /** 实例视图：state 为归一后的六态口径（与运行状态轮询同词表），rawState 保留 DS 原文。 */
    public record InstanceView(long id, String name, String state, String rawState,
                               Instant startTime, Instant endTime, Integer runTimes, String host) {
    }

    public record InstancesResponse(List<InstanceView> items, long total, int page, int size) {
    }

    public record TaskView(long id, String name, String state, String rawState,
                           Instant startTime, Instant endTime) {
    }

    public record LogView(int lines, String logText) {
    }

    public record BackfillRequest(String startDate, String endDate) {
    }

    public InstancesResponse instances(String jobId, Integer page, Integer size,
                                       String state, String startDate, String endDate) {
        var context = scheduleService.requireDolphinJob(jobId);
        var pageNo = page == null ? 1 : Math.max(1, Math.min(page, 100));
        var pageSize = size == null ? 10 : Math.max(1, Math.min(size, 50));
        var stateFilter = state == null || state.isBlank() ? null : state.trim().toUpperCase();
        if (stateFilter != null && !STATE_FILTER.matcher(stateFilter).matches()) {
            throw new InvalidRequestException("实例状态过滤值不合法");
        }
        try {
            var result = client.instances(context.codes().projectCode(), context.codes().workflowDefinitionCode(),
                    stateFilter, pageNo, pageSize, normalizeDate(startDate), normalizeDate(endDate));
            var items = result.items().stream()
                    .map(item -> new InstanceView(item.id(), item.name(),
                            DolphinSchedulerExecutorAdapter.normalizeStatus(item.state()), item.state(),
                            item.startTime(), item.endTime(), item.runTimes(), item.host()))
                    .toList();
            return new InstancesResponse(items, result.total(), pageNo, pageSize);
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
    }

    public List<TaskView> tasks(String jobId, long instanceId) {
        var context = scheduleService.requireDolphinJob(jobId);
        try {
            return client.tasks(context.codes().projectCode(), instanceId).stream()
                    .map(task -> new TaskView(task.id(), task.name(),
                            DolphinSchedulerExecutorAdapter.normalizeStatus(task.state()), task.state(),
                            task.startTime(), task.endTime()))
                    .toList();
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
    }

    public LogView taskLog(String jobId, long instanceId, long taskInstanceId, Integer lines) {
        // 实例归属校验：任务必须属于该 job 绑定工作流的实例（防跨任务日志读取）。
        var context = scheduleService.requireDolphinJob(jobId);
        try {
            var instance = client.instances(context.codes().projectCode(),
                    context.codes().workflowDefinitionCode(), null, 1, 100, null, null);
            boolean owned = instance.items().stream().anyMatch(item -> item.id() == instanceId);
            if (!owned) {
                // 分页之外的实例按任务面归属兜底校验。
                var instanceTasks = client.tasks(context.codes().projectCode(), instanceId);
                if (instanceTasks.isEmpty()) {
                    throw new ConflictException("实例不属于该任务绑定的工作流");
                }
            }
            var limit = lines == null ? 200 : Math.max(1, Math.min(lines, MAX_LOG_LINES));
            var text = client.taskLog(taskInstanceId, limit);
            var lineCount = text.isBlank() ? 0 : text.split("\n", -1).length;
            return new LogView(lineCount, text);
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
    }

    /** 终止（STOP）：仅运行中的实例可终止。 */
    public void stop(String jobId, long instanceId) {
        requireInstanceState(jobId, instanceId, "RUNNING");
        var context = scheduleService.requireDolphinJob(jobId);
        try {
            client.execute(context.codes().projectCode(), instanceId, "STOP");
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
    }

    /** 重跑（REPEAT_RUNNING）：仅终态实例可重跑。 */
    public void retry(String jobId, long instanceId) {
        var state = requireInstanceState(jobId, instanceId, null);
        if (!"SUCCEEDED".equals(state) && !"FAILED".equals(state) && !"CANCELED".equals(state)) {
            throw new ConflictException("仅已完成的实例可重跑（当前：" + state + "）");
        }
        var context = scheduleService.requireDolphinJob(jobId);
        try {
            client.execute(context.codes().projectCode(), instanceId, "REPEAT_RUNNING");
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
    }

    /** 补数：按日期区间逐日触发绑定工作流（DS COMPLEMENT_DATA）；区间上限防失控。 */
    public void backfill(String jobId, BackfillRequest request) {
        if (request == null || isBlank(request.startDate()) || isBlank(request.endDate())) {
            throw new InvalidRequestException("补数需要开始与结束日期（yyyy-MM-dd）");
        }
        var start = parseDate(request.startDate());
        var end = parseDate(request.endDate());
        if (start == null || end == null) {
            throw new InvalidRequestException("补数日期格式应为 yyyy-MM-dd");
        }
        if (start.isAfter(end)) {
            throw new InvalidRequestException("补数开始日期不能晚于结束日期");
        }
        var days = ChronoUnit.DAYS.between(start, end) + 1;
        if (days > MAX_BACKFILL_DAYS) {
            throw new InvalidRequestException("补数区间不能超过 " + MAX_BACKFILL_DAYS + " 天（当前 " + days + " 天）");
        }
        var context = scheduleService.requireDolphinJob(jobId);
        try {
            client.backfill(context.codes().projectCode(), context.codes().workflowDefinitionCode(),
                    start.atStartOfDay().format(DS_TIME),
                    end.atStartOfDay().format(DS_TIME));
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
    }

    private String requireInstanceState(String jobId, long instanceId, String expected) {
        var context = scheduleService.requireDolphinJob(jobId);
        try {
            var page = client.instances(context.codes().projectCode(),
                    context.codes().workflowDefinitionCode(), null, 1, 100, null, null);
            var found = page.items().stream().filter(item -> item.id() == instanceId).findFirst();
            if (found.isEmpty()) {
                throw new ConflictException("实例不属于该任务绑定的工作流");
            }
            var normalized = DolphinSchedulerExecutorAdapter.normalizeStatus(found.get().state());
            if (expected != null && !expected.equals(normalized)) {
                throw new ConflictException("实例当前状态不允许该操作（" + normalized + "）");
            }
            return normalized;
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
    }

    private LocalDate parseDate(String value) {
        try {
            return LocalDate.parse(value.trim());
        } catch (DateTimeParseException | IllegalArgumentException exception) {
            return null;
        }
    }

    /** 日期过滤透传：yyyy-MM-dd 或完整时间都接受，非法直接 400。 */
    private String normalizeDate(String value) {
        if (value == null || value.isBlank()) return null;
        var trimmed = value.trim();
        if (trimmed.length() == 10) {
            try {
                LocalDate.parse(trimmed);
                return trimmed;
            } catch (DateTimeParseException ignored) {
                throw new InvalidRequestException("日期过滤格式应为 yyyy-MM-dd");
            }
        }
        try {
            LocalDateTime.parse(trimmed, DS_TIME);
            return trimmed;
        } catch (DateTimeParseException ignored) {
            throw new InvalidRequestException("日期过滤格式应为 yyyy-MM-dd HH:mm:ss");
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
