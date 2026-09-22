package com.cywu.dataos.controlplane.delivery;

import jakarta.validation.constraints.NotBlank;

/**
 * 追加交付项（POST /api/v1/deliveries/{id}/items）。本地类型
 * （DATA_SERVICE / AI_DATA_PRODUCT）加入时即校验存在；ASSET / DASHBOARD
 * 的远端存在性在提交（READY 前）统一核验。
 */
public record AddDeliveryItemRequest(
        @NotBlank String refType,
        @NotBlank String refId,
        String note) {
}
