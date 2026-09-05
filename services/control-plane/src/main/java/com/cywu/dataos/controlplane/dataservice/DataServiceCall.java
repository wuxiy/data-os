package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;

/**
 * 数据服务调用审计（{@code data_os.data_service_call} 表）。由执行面
 * data-api 回写，{@code idempotency_key} 保证重试幂等；
 * {@code kind} 区分同步查询（query）与异步导出（export，P7）。
 */
public record DataServiceCall(
        String id,
        String serviceId,
        String tenantId,
        String keyId,
        String idempotencyKey,
        String parametersJson,
        int rowCount,
        boolean truncated,
        int elapsedMs,
        int statusCode,
        Instant calledAt,
        String kind) {

    public DataServiceCall {
        if (kind == null || kind.isBlank()) {
            kind = "query";
        }
    }
}
