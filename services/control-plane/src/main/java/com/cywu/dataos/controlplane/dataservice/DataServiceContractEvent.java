package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;

/**
 * 数据合同事件（P8 余项）：合同变更的不可变事实，双通道分发——
 * webhook 订阅推送（data_service_delivery 发件箱）与调用方 API 轮询。
 * changeType：PUBLISHED / UPDATED / DEPRECATED / TEST。
 */
public record DataServiceContractEvent(
        String id,
        String serviceId,
        String tenantId,
        String serviceCode,
        String changeType,
        String fromVersion,
        String toVersion,
        String diffJson,
        Instant createdAt) {
}
