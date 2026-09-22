package com.cywu.dataos.controlplane.delivery;

/**
 * 交付项引用类型（G25 计划固定四种）：OM 表资产 / Superset 仪表盘 /
 * 数据服务（Data API）/ AI 数据产品。存在性与可交付性口径见
 * {@code DeliveryEvidenceCollector}。
 */
public enum DeliveryRefType {
    ASSET,
    DASHBOARD,
    DATA_SERVICE,
    AI_DATA_PRODUCT;

    public static DeliveryRefType parse(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("引用类型不能为空");
        }
        return DeliveryRefType.valueOf(value.trim().toUpperCase());
    }
}
