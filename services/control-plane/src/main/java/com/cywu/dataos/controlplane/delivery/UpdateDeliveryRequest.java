package com.cywu.dataos.controlplane.delivery;

import java.time.LocalDate;

import jakarta.validation.constraints.NotBlank;

/**
 * 更新交付项目（PUT /api/v1/deliveries/{id}）：仅 DRAFT / IN_PROGRESS 可改，
 * 交付范围、Owner 与目标日期是验收证据的组成部分。
 */
public record UpdateDeliveryRequest(
        @NotBlank String name,
        String scope,
        String owner,
        LocalDate targetDate) {
}
