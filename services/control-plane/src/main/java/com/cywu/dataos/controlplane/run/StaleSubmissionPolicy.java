package com.cywu.dataos.controlplane.run;

/**
 * 过期 SUBMITTING 运行的处置策略：两侧行为差异的显式声明（领域定义见
 * CONTEXT.md「外部运行」），不是待消除的重复。
 */
public enum StaleSubmissionPolicy {
    /**
     * 提交结果未知时转 UNKNOWN 走人工对账。适用于外部副作用不可重入的
     * 运行（采集运行：盲目重投可能造成双重采集）。
     */
    MARK_UNKNOWN_RECONCILE,

    /**
     * 提交幂等（执行批次号即执行器主键），可安全原地重投并指数退避。
     * 适用于只读检查类运行（质量复检运行）。
     */
    RESUBMIT_BACKOFF
}
