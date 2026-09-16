package com.cywu.dataos.controlplane.ai;

import java.time.Instant;

/**
 * AI Data 构建任务（G20-1，backlog AI-4）：build API 异步化的一次投递。
 * 状态机 QUEUED → RUNNING → SUCCEEDED / FAILED；认领走 CAS（仅 QUEUED 可转 RUNNING），
 * 终态持久化（result_json 与旧同步响应同构，失败留 error）。
 */
public record AIBuildJob(
        String id,
        String productId,
        String tenantId,
        String versionSn,
        String recipeRef,
        String status,
        String resultJson,
        String error,
        String createdBy,
        Instant createdAt,
        Instant startedAt,
        Instant finishedAt) {

    public static final String STATUS_QUEUED = "QUEUED";
    public static final String STATUS_RUNNING = "RUNNING";
    public static final String STATUS_SUCCEEDED = "SUCCEEDED";
    public static final String STATUS_FAILED = "FAILED";

    public boolean active() {
        return STATUS_QUEUED.equals(status) || STATUS_RUNNING.equals(status);
    }
}
