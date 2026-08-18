package com.cywu.dataos.controlplane.run;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * 外部运行生命周期模块的持久化端口：只讲生命周期骨架语汇。两侧各自
 * 用现有表结构实现（采集侧：状态格条件更新；质量侧：租约列），业务
 * 载荷 {@code S} 由实现写进各自的列。
 */
public interface RunStateStore<R extends ExternalRun, S> {

    /**
     * 提交前领取租约。返回 false 表示他人持有（或退避未到），本次放弃。
     * 无租约编码的一侧（提交行本身即租约）恒返回 true。
     */
    boolean claimSubmissionLease(R run, Instant leaseUntil);

    /**
     * 提交结果的 CAS 回写：SUBMITTING -> SUBMITTED（携带外部编号），
     * 或提交终态失败（如 SUBMIT_FAILED）。返回是否命中。
     */
    boolean completeSubmission(R run, String status, String externalId, String message,
                               Instant startedAt, Instant finishedAt);

    /** 提交可重试失败：保留 SUBMITTING，记录错误与下次尝试时间。 */
    void markSubmissionRetryable(R run, String message, Instant retryAt);

    /** 待处理的运行：含正常轮询候选与（采集侧）按内部编号对账的候选。 */
    List<R> findSyncCandidates(Instant now);

    /**
     * 状态轮询前领取租约。无租约编码的一侧恒返回 true（状态条件更新
     * 自身防重）。
     */
    boolean claimStatusPoll(R run, Instant leaseUntil);

    /**
     * 状态回写（终态或非终态）。载荷与状态在同一条件更新中落库；
     * 返回是否命中。
     */
    boolean applyStatus(R run, String status, String message,
                        Instant startedAt, Instant finishedAt, S payload, Instant nextPollAt);

    /** 轮询临时失败：保留当前状态，记录错误与下次轮询时间。 */
    void markPollRetryable(R run, String message, Instant nextPollAt);

    /** 按内部编号对账成功后，为 UNKNOWN 运行挂接外部编号。 */
    boolean linkReconciled(R run, String externalId, String message);

    /** 要求人工对账（UNKNOWN / MANUAL_REQUIRED 路径）。 */
    void markReconciliationRequired(R run, String message);

    /**
     * 清扫过期 SUBMITTING（仅 MARK_UNKNOWN_RECONCILE 一侧实现；
     * RESUBMIT_BACKOFF 一侧的重投由轮询候选驱动）。
     */
    default int recoverStaleSubmissions(long leaseMillis) {
        return 0;
    }

    /** 回写后重读运行（无命中时返回空）。 */
    Optional<R> reload(R run);
}
