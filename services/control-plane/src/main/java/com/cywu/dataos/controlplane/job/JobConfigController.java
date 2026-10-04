package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.Map;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/jobs/{jobId}/config")
public class JobConfigController {

    private final JobConfigService service;

    public JobConfigController(JobConfigService service) {
        this.service = service;
    }

    @GetMapping
    public JobConfigResponse get(@PathVariable String jobId) {
        var config = service.get(jobId);
        return new JobConfigResponse(config.jobId(), config.templateKey(), config.templateVersion(),
                config.config(), config.updatedAt(), config.structured(), service.lastSuccessWatermark(jobId));
    }

    @PutMapping
    public JobConfigResponse save(@PathVariable String jobId,
                                  @Valid @RequestBody SaveJobConfigRequest request) {
        var config = service.save(jobId, request);
        return new JobConfigResponse(config.jobId(), config.templateKey(), config.templateVersion(),
                config.config(), config.updatedAt(), config.structured(), service.lastSuccessWatermark(jobId));
    }

    /**
     * 配置读取面（G2G 批次 1 第二刀）：编译产物 config + 结构化意图 structured
     * + 最近成功水位（增量序列键回放起点）。
     */
    public record JobConfigResponse(
            String jobId,
            String templateKey,
            int templateVersion,
            Map<String, Object> config,
            Instant updatedAt,
            Map<String, Object> structured,
            Instant lastSuccessWatermark) {
    }
}
