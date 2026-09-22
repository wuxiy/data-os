package com.cywu.dataos.controlplane.delivery;

import java.time.LocalDate;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * 创建交付项目（G25-1 POST /api/v1/deliveries）。code 租户内唯一；
 * scope/owner/targetDate 均可后补（PUT 更新）。代码格式校验在服务层统一收口。
 */
public record CreateDeliveryRequest(
        @NotBlank String code,
        @NotBlank String name,
        String scope,
        String owner,
        LocalDate targetDate,
        @Valid List<ItemContract> items) {

    /** 创建时可选内联的首批交付项（与逐项 POST /items 等价，便于建项即建清单）。 */
    public record ItemContract(
            @NotBlank String refType,
            @NotBlank String refId,
            String note) {
    }
}
