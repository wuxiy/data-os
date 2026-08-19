package com.cywu.dataos.mpi.metrics;

import java.util.Map;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.cywu.dataos.mpi.security.TenantScope;

/**
 * MPI 指标端点（验收清单第 8 项：五项指标，门户指标卡与 API 一致）。
 * 真实统计来自 MpiMetricsService；Doris 未配置时 503。
 */
@RestController
@RequestMapping("/api/v1/mpi")
public class MpiMetricsController {

    private final TenantScope tenantScope;
    private final ObjectProvider<MpiMetricsService> metricsService;

    public MpiMetricsController(TenantScope tenantScope, ObjectProvider<MpiMetricsService> metricsService) {
        this.tenantScope = tenantScope;
        this.metricsService = metricsService;
    }

    @GetMapping("/metrics")
    public Map<String, Long> metrics() {
        var service = metricsService.getIfAvailable();
        if (service == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Doris 批处理通道未配置");
        }
        return service.metrics(tenantScope.current().tenantId());
    }
}
