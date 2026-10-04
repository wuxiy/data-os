package com.cywu.dataos.controlplane.job;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 调度实例面（G2G 批次 5 第二刀）：DS 通道任务的实例列表/任务/日志/终止/
 * 重跑/补数。实例以 DS 为唯一事实源实时代理，不落 control-plane run 表。
 */
@RestController
@RequestMapping("/api/v1/jobs/{jobId}/instances")
public class JobScheduleInstancesController {

    private final JobScheduleInstanceService service;

    public JobScheduleInstancesController(JobScheduleInstanceService service) {
        this.service = service;
    }

    @GetMapping
    public JobScheduleInstanceService.InstancesResponse list(
            @PathVariable String jobId,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return service.instances(jobId, page, size, state, startDate, endDate);
    }

    @GetMapping("/{instanceId}/tasks")
    public List<JobScheduleInstanceService.TaskView> tasks(@PathVariable String jobId,
                                                           @PathVariable long instanceId) {
        return service.tasks(jobId, instanceId);
    }

    @GetMapping("/{instanceId}/tasks/{taskInstanceId}/log")
    public JobScheduleInstanceService.LogView taskLog(@PathVariable String jobId,
                                                      @PathVariable long instanceId,
                                                      @PathVariable long taskInstanceId,
                                                      @RequestParam(required = false) Integer lines) {
        return service.taskLog(jobId, instanceId, taskInstanceId, lines);
    }

    @PostMapping("/{instanceId}/stop")
    public void stop(@PathVariable String jobId, @PathVariable long instanceId) {
        service.stop(jobId, instanceId);
    }

    @PostMapping("/{instanceId}/retry")
    public void retry(@PathVariable String jobId, @PathVariable long instanceId) {
        service.retry(jobId, instanceId);
    }

    /** 补数（COMPLEMENT_DATA）：按日期区间逐日触发绑定工作流。 */
    @PostMapping("/backfill")
    public void backfill(@PathVariable String jobId,
                         @RequestBody JobScheduleInstanceService.BackfillRequest request) {
        service.backfill(jobId, request);
    }
}
