package com.cywu.dataos.controlplane.run;

import java.time.Instant;

/**
 * 外部运行终态的业务效果。回调在终态回写的同一事务内执行：条件更新
 * 未命中（他方已处理）时不调用；抛异常则终态写入一并回滚。
 */
public interface RunTerminalEffects<R extends ExternalRun, S> {

    /** 轮询得到终态（SUCCEEDED / FAILED / CANCELED…）后调用。 */
    default void onTerminal(R run, String status, S payload, Instant startedAt, Instant finishedAt) {
    }

    /** 提交终态失败后调用（仅声明了 submitFailureEffects 的一侧）。 */
    default void onSubmissionFailed(R run, String status, String message) {
    }
}
