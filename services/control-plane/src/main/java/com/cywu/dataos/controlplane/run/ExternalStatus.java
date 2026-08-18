package com.cywu.dataos.controlplane.run;

import java.time.Instant;

/**
 * 执行器状态查询的中性结果。载荷 {@code S} 是该侧状态结果的业务字段
 * （质量侧：passed / 样本证据 / artifactUri；采集侧无此类字段），由
 * 生命周期模块透明搬运，与状态回写在同一条件更新中落库。
 */
public record ExternalStatus<S>(
        String status,
        String message,
        Instant startedAt,
        Instant finishedAt,
        S payload) {
}
