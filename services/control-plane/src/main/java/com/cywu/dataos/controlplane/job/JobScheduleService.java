package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.executor.DolphinBinding;
import com.cywu.dataos.controlplane.executor.DolphinScheduleClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;

/**
 * 采集任务的周期调度面（G2G 批次 5 第一刀）：DS 通道任务的调度配置读写、
 * 上下线与触发预览。调度状态以 DolphinScheduler 为唯一事实源，本服务只做
 * 任务侧的通道/绑定校验与代理（nema etl 调度语义的中文化承接）。
 */
@Service
public class JobScheduleService {

    private static final DateTimeFormatter DS_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final int MAX_FIRE_TIMES = 5;

    private final JobRepository jobs;
    private final JobConfigRepository jobConfigs;
    private final DolphinScheduleClient client;
    private final ZoneId schedulerZone;

    public JobScheduleService(JobRepository jobs,
                              JobConfigRepository jobConfigs,
                              DolphinScheduleClient client,
                              @Value("${data-os.dolphinscheduler.time-zone:Asia/Shanghai}") String timeZone) {
        this.jobs = jobs;
        this.jobConfigs = jobConfigs;
        this.client = client;
        this.schedulerZone = ZoneId.of(timeZone == null || timeZone.isBlank() ? "Asia/Shanghai" : timeZone);
    }

    /** 任务视角的调度状态：scheduled=false 即「手动调度」（nema MANUAL 语义）。 */
    public record JobScheduleView(Long scheduleId, String crontab, String startTime, String endTime,
                                  String timezoneId, boolean online, String warningType,
                                  Instant nextFireTime, boolean scheduled) {
        static JobScheduleView manual() {
            return new JobScheduleView(null, null, null, null, null, false, null, null, false);
        }

        static JobScheduleView from(DolphinScheduleClient.ScheduleRecord record) {
            return new JobScheduleView(record.id(), record.crontab(), record.startTime(), record.endTime(),
                    record.timezoneId(), record.online(), record.warningType(), record.nextFireTime(), true);
        }
    }

    public record SaveScheduleRequest(String crontab, String startTime, String endTime,
                                      String timezoneId, String warningType) {
    }

    public record PreviewRequest(String crontab, String startTime, String endTime, String timezoneId) {
    }

    /** source=DS（引擎计算）|LOCAL（DS 不可达时本地 Spring cron 计算，如实标注）。 */
    public record PreviewResult(String source, List<Instant> fireTimes) {
    }

    public JobScheduleView view(String jobId) {
        var context = requireDolphinJob(jobId);
        var record = client.find(context.codes().projectCode(), context.codes().workflowDefinitionCode());
        return record == null ? JobScheduleView.manual() : JobScheduleView.from(record);
    }

    /** 保存（新建或更新）。不改变上下线状态：新建为下线态，须显式上线。 */
    public JobScheduleView save(String jobId, SaveScheduleRequest request) {
        if (request == null || request.crontab() == null || request.crontab().isBlank()) {
            throw new InvalidRequestException("CRON 表达式不能为空");
        }
        var crontab = normalizeCron(request.crontab());
        validateCron(crontab);
        var startTime = requireTimeFormat(request.startTime(), true);
        var endTime = requireTimeFormat(request.endTime(), false);
        if (startTime != null && endTime != null && !startTime.isBefore(endTime)) {
            throw new InvalidRequestException("生效开始时间必须早于结束时间");
        }
        var context = requireDolphinJob(jobId);
        var timezoneId = isBlank(request.timezoneId()) ? null : request.timezoneId().trim();
        var existing = client.find(context.codes().projectCode(), context.codes().workflowDefinitionCode());
        try {
            if (existing == null) {
                client.create(context.codes().projectCode(), context.codes().workflowDefinitionCode(),
                        crontab, request.startTime(), request.endTime(), timezoneId, request.warningType());
            } else {
                client.update(context.codes().projectCode(), existing.id(),
                        crontab, request.startTime(), request.endTime(), timezoneId, request.warningType());
            }
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
        return view(jobId);
    }

    public JobScheduleView setOnline(String jobId) {
        var existing = requireSchedule(jobId);
        try {
            client.online(existing.codes().projectCode(), existing.schedule().id());
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
        return view(jobId);
    }

    public JobScheduleView setOffline(String jobId) {
        var existing = requireSchedule(jobId);
        try {
            client.offline(existing.codes().projectCode(), existing.schedule().id());
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
        return view(jobId);
    }

    /** 删除调度=回到手动调度；本就没有调度时幂等成功。 */
    public void deleteSchedule(String jobId) {
        var context = requireDolphinJob(jobId);
        var existing = client.find(context.codes().projectCode(), context.codes().workflowDefinitionCode());
        if (existing == null) return;
        try {
            client.delete(context.codes().projectCode(), existing.id());
        } catch (AdapterConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        }
    }

    public PreviewResult preview(String jobId, PreviewRequest request) {
        if (request == null || request.crontab() == null || request.crontab().isBlank()) {
            throw new InvalidRequestException("CRON 表达式不能为空");
        }
        var crontab = normalizeCron(request.crontab());
        var expression = validateCron(crontab);
        var context = requireDolphinJob(jobId);
        try {
            var times = client.preview(context.codes().projectCode(), crontab,
                    request.startTime(), request.endTime(),
                    isBlank(request.timezoneId()) ? null : request.timezoneId().trim());
            if (!times.isEmpty()) {
                return new PreviewResult("DS", times);
            }
        } catch (AdapterUnavailableException | AdapterConfigurationException ignored) {
            // DS 不可达/拒绝时退本地计算并标注来源，不让预览阻断配置。
        }
        return new PreviewResult("LOCAL", localFireTimes(expression, request.startTime()));
    }

    private List<Instant> localFireTimes(org.springframework.scheduling.support.CronExpression expression,
                                         String startTime) {
        var start = LocalDateTime.now(schedulerZone);
        if (startTime != null && !startTime.isBlank()) {
            try {
                start = LocalDateTime.parse(startTime.trim(), DS_TIME);
            } catch (DateTimeParseException ignored) {
                // 起始时间非法时按当前时刻起算（前置校验已兜住常规路径）。
            }
        }
        var times = new ArrayList<Instant>();
        var cursor = start;
        for (int i = 0; i < MAX_FIRE_TIMES; i++) {
            var next = expression.next(cursor);
            if (next == null) break;
            times.add(next.atZone(schedulerZone).toInstant());
            cursor = next.plus(1, ChronoUnit.SECONDS);
        }
        return times;
    }

    /** 7 位 quartz cron 去掉年份位后用 Spring 6 位语义校验（DS 兼容两种位数）。 */
    private String normalizeCron(String crontab) {
        var parts = crontab.trim().split("\\s+");
        if (parts.length == 7) {
            return String.join(" ", java.util.Arrays.copyOf(parts, 6));
        }
        return crontab.trim();
    }

    private org.springframework.scheduling.support.CronExpression validateCron(String crontab) {
        try {
            return org.springframework.scheduling.support.CronExpression.parse(crontab);
        } catch (IllegalArgumentException exception) {
            throw new InvalidRequestException("CRON 表达式不合法（应为 秒 分 时 日 月 周 六位，DS quartz 方言）");
        }
    }

    private LocalDateTime requireTimeFormat(String value, boolean isStart) {
        if (value == null || value.isBlank()) return null;
        try {
            return LocalDateTime.parse(value.trim(), DS_TIME);
        } catch (DateTimeParseException exception) {
            throw new InvalidRequestException((isStart ? "生效开始" : "生效结束")
                    + "时间格式应为 yyyy-MM-dd HH:mm:ss");
        }
    }

    record JobContext(DolphinBinding.Codes codes) {
    }

    private record ScheduleContext(DolphinBinding.Codes codes,
                                   DolphinScheduleClient.ScheduleRecord schedule) {
    }

    /** 通道/绑定守卫（实例域同包复用：DS 通道 + 工作流绑定在册）。 */
    JobContext requireDolphinJob(String jobId) {
        var job = jobs.findById(jobId)
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + jobId));
        if (!"DOLPHINSCHEDULER".equalsIgnoreCase(job.executor())
                && !"DOLPHIN_SCHEDULER".equalsIgnoreCase(job.executor())) {
            throw new ConflictException("仅平台调度（DolphinScheduler）通道的任务支持周期调度");
        }
        var config = jobConfigOf(jobId);
        try {
            var binding = DolphinBinding.locate(config);
            return new JobContext(DolphinBinding.requireCodes(binding));
        } catch (AdapterConfigurationException exception) {
            // 绑定缺失/不完整对调用方是可修复的任务状态冲突，不是 500。
            throw new ConflictException("任务缺少 DolphinScheduler 工作流绑定（projectCode/workflowDefinitionCode），请先在任务配置中登记");
        }
    }

    private ScheduleContext requireSchedule(String jobId) {
        var context = requireDolphinJob(jobId);
        var record = client.find(context.codes().projectCode(), context.codes().workflowDefinitionCode());
        if (record == null) {
            throw new ConflictException("尚未配置调度，请先保存调度配置");
        }
        return new ScheduleContext(context.codes(), record);
    }

    private java.util.Map<String, Object> jobConfigOf(String jobId) {
        try {
            return jobConfigs.findByJobId(jobId).map(IngestionJobConfig::config).orElse(java.util.Map.of());
        } catch (DataAccessException exception) {
            // 测试库无 job_configs 表时按空配置处理（与评分域同款容错）。
            return java.util.Map.of();
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
