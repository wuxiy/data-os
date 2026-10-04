package com.cywu.dataos.controlplane.job;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 采集任务的周期调度面（G2G 批次 5 第一刀）：DS 通道任务专属，其它通道 409。
 */
@RestController
@RequestMapping("/api/v1/jobs/{jobId}/schedule")
public class JobScheduleController {

    private final JobScheduleService service;

    public JobScheduleController(JobScheduleService service) {
        this.service = service;
    }

    @GetMapping
    public JobScheduleService.JobScheduleView view(@PathVariable String jobId) {
        return service.view(jobId);
    }

    /** 保存（新建或更新）：不改变上下线状态，新建后为下线态。 */
    @PutMapping
    public JobScheduleService.JobScheduleView save(@PathVariable String jobId,
                                                   @RequestBody JobScheduleService.SaveScheduleRequest request) {
        return service.save(jobId, request);
    }

    @PostMapping("/online")
    public JobScheduleService.JobScheduleView online(@PathVariable String jobId) {
        return service.setOnline(jobId);
    }

    @PostMapping("/offline")
    public JobScheduleService.JobScheduleView offline(@PathVariable String jobId) {
        return service.setOffline(jobId);
    }

    /** 删除调度=回到手动调度（幂等）。 */
    @DeleteMapping
    public ResponseEntity<Void> delete(@PathVariable String jobId) {
        service.deleteSchedule(jobId);
        return ResponseEntity.noContent().build();
    }

    /** 未来 5 次触发时间预览（优先 DS 引擎计算，不可达时本地计算并标注来源）。 */
    @PostMapping("/preview")
    public JobScheduleService.PreviewResult preview(@PathVariable String jobId,
                                                    @RequestBody JobScheduleService.PreviewRequest request) {
        return service.preview(jobId, request);
    }
}
