package com.cywu.dataos.mpi.metrics;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * MPI 指标端点（验收清单第 8 项：五项指标，门户指标卡与 API 一致）。
 * G3.1 脚手架阶段返回零值占位，G3.5 接入真实统计（Doris/PG 计数）后
 * 数值方为可信；键名从现在起即是对外契约。
 */
@RestController
@RequestMapping("/api/v1/mpi")
public class MpiMetricsController {

    @GetMapping("/metrics")
    public Map<String, Long> metrics() {
        Map<String, Long> metrics = new LinkedHashMap<>();
        metrics.put("identitiesLoaded", 0L);
        metrics.put("goldenPersons", 0L);
        metrics.put("autoMatches", 0L);
        metrics.put("reviewPending", 0L);
        metrics.put("reviewResolved", 0L);
        return metrics;
    }
}
