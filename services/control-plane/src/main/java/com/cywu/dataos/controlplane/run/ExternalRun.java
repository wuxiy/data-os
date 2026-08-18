package com.cywu.dataos.controlplane.run;

import java.time.Instant;

/**
 * 外部运行在生命周期模块眼中的最小视图。两侧运行记录实现本接口；
 * 模块只依赖这些读取器，不感知各自的表结构与业务列。
 */
public interface ExternalRun {

    String id();

    String status();

    String externalId();

    /** 运行使用的执行器名（用于路由执行器会话与错误消息）。 */
    String executor();

    /** 下次允许轮询的时间；无退避编码的一侧为 null。 */
    default Instant nextPollAt() {
        return null;
    }

    /** 已尝试次数，用于指数退避；无退避编码的一侧为 0。 */
    default int attemptCount() {
        return 0;
    }

    default boolean terminal() {
        return RunStatus.isTerminal(status());
    }

    default String reconciliationStatus() {
        return null;
    }
}
