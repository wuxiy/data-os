package com.cywu.dataos.controlplane.run;

import java.util.Optional;

import com.cywu.dataos.controlplane.executor.AdapterReconciliation;

/**
 * 执行器 seam 在生命周期模块一侧的形状：按运行找到执行器会话，会话
 * 负责提交、查状态，以及（可选）按内部运行编号对账。厂商差异（URL、
 * 认证、状态词表、重试分类）留在各执行器适配器内。
 */
public interface ExternalExecutorPort<R extends ExternalRun, C, S> {

    Optional<ExecutorSession<R, C, S>> find(R run);

    interface ExecutorSession<R extends ExternalRun, C, S> {

        ExternalSubmission submit(R run, C command);

        ExternalStatus<S> status(R run);

        /** 按内部运行编号对账；执行器不支持时返回 MANUAL_REQUIRED。 */
        default AdapterReconciliation reconcile(R run) {
            return AdapterReconciliation.manualRequired("执行器不支持按内部运行编号对账，请人工确认");
        }
    }
}
