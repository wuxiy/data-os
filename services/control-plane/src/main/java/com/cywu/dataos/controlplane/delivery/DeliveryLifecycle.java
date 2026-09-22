package com.cywu.dataos.controlplane.delivery;

/**
 * 交付项目生命周期（G25，唯一来源）：DRAFT → IN_PROGRESS → READY_FOR_ACCEPTANCE
 * → ACCEPTED → ARCHIVED。submit（进入 READY）前逐项做可交付性检查，失败项明确阻断。
 */
public enum DeliveryLifecycle {
    DRAFT,
    IN_PROGRESS,
    READY_FOR_ACCEPTANCE,
    ACCEPTED,
    ARCHIVED
}
