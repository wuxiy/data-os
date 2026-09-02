package com.cywu.dataos.controlplane.run;

/**
 * 一侧外部运行的行为声明：状态机归生命周期模块所有，两侧的词汇差异
 * 与处置差异全部显式落在此记录里，而不是散落在两份实现中。
 *
 * <p>每个字段的取值都必须与该侧既有行为一一对应；修改任何一个都意味着
 * 行为变更，需要独立验收。</p>
 *
 * @param staleSubmission            过期 SUBMITTING 的处置（见 {@link StaleSubmissionPolicy}）
 * @param retryUnavailableSubmit     提交遇到执行器不可达时是否原地重试（true=保留 SUBMITTING 按退避重投；
 *                                   false=立即终态）
 * @param submitFailureEffects       提交终态失败是否触发同事务业务效果（质量侧：问题退回+事件+通知）
 * @param submitUnsupportedStatus    执行器不受支持时的提交终态
 * @param submitMissingExternalIdStatus 执行器未返回外部编号时的提交结果（UNKNOWN=转人工对账）
 * @param submitUnknownOutcomeStatus 提交结果不确定异常的映射；null 表示按运行时失败处理
 * @param submitMisconfiguredStatus  执行器配置错误时的提交终态
 * @param submitUnavailableStatus    执行器不可达时的提交终态（仅 retryUnavailableSubmit=false 使用）
 * @param submitFailedStatus         其余提交失败的终态
 * @param submitRuntimeErrorPrefix   其余提交失败消息前缀（无前缀一侧为空串）
 * @param unsupportedExecutorMessageTemplate 不受支持消息模板，%s 为执行器名
 * @param missingExternalIdMessage   未返回外部编号的固定消息
 * @param pollUnsupportedStatus      轮询发现执行器不受支持时的写入状态
 * @param pollTerminalEffects        轮询错误终态（不受支持/配置错误）是否触发同事务业务效果
 * @param pollMisconfiguredStatus    轮询遇到配置错误时的终态
 * @param pollRetainsStatusOnError   轮询临时失败时 true=保留状态仅覆盖消息；false=记错误并按轮询间隔重试
 * @param reconcileMissingExternalId 无外部编号的 UNKNOWN 运行是否按内部编号向执行器对账
 *                                   （采集侧执行器支持；质量侧批次号必有，不存在此路径）
 * @param pollIntervalMs             轮询间隔与退避基准
 * @param submitLeaseMs              提交/轮询租约时长
 */
public record RunPolicy(
        StaleSubmissionPolicy staleSubmission,
        boolean retryUnavailableSubmit,
        boolean submitFailureEffects,
        String submitUnsupportedStatus,
        String submitMissingExternalIdStatus,
        String submitUnknownOutcomeStatus,
        String submitMisconfiguredStatus,
        String submitUnavailableStatus,
        String submitFailedStatus,
        String submitRuntimeErrorPrefix,
        String unsupportedExecutorMessageTemplate,
        String missingExternalIdMessage,
        String pollUnsupportedStatus,
        boolean pollTerminalEffects,
        String pollMisconfiguredStatus,
        boolean pollRetainsStatusOnError,
        boolean reconcileMissingExternalId,
        long pollIntervalMs,
        long submitLeaseMs) {

    public RunPolicy {
        if (pollIntervalMs < 1 || submitLeaseMs < 1) {
            throw new IllegalArgumentException("轮询间隔与提交租约必须为正数");
        }
    }

    /**
     * 采集侧行为声明：外部写入不可重入，提交失败一律终态、宁可疑转对账
     * （无外部编号时按内部编号对账）。构造集中在此——两侧服务不再各自
     * 拼 19 个位置字面量（相邻同型字符串交换不再无声编译通过）。
     */
    public static RunPolicy ingestion(long pollIntervalMs, long submitLeaseMs) {
        return new RunPolicy(
                StaleSubmissionPolicy.MARK_UNKNOWN_RECONCILE,
                false,
                false,
                "UNSUPPORTED_EXECUTOR",
                "UNKNOWN",
                "UNKNOWN",
                "BLOCKED_CONFIGURATION",
                "BLOCKED_DEPENDENCY",
                "SUBMIT_FAILED",
                "执行器提交失败：",
                "暂不支持执行器：%s",
                "中心采集执行器未返回外部运行编号，需按 data_os_run_id 对账",
                "UNKNOWN",
                false,
                "FAILED",
                true,
                true,
                pollIntervalMs,
                submitLeaseMs);
    }

    /** 质量侧行为声明：提交幂等可重投退避；错误终态同事务推进问题工作流。 */
    public static RunPolicy qualityRecheck(long pollIntervalMs, long submitLeaseMs) {
        return new RunPolicy(
                StaleSubmissionPolicy.RESUBMIT_BACKOFF,
                true,
                true,
                "SUBMIT_FAILED",
                "SUBMIT_FAILED",
                null,
                "SUBMIT_FAILED",
                "SUBMIT_FAILED",
                "SUBMIT_FAILED",
                "",
                "暂不支持质量规则执行器：%s",
                "质量规则执行器未返回外部批次编号",
                "FAILED",
                true,
                "FAILED",
                false,
                false,
                pollIntervalMs,
                submitLeaseMs);
    }
}
