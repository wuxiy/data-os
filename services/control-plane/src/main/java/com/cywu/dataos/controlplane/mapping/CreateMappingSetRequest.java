package com.cywu.dataos.controlplane.mapping;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * 创建映射集（G23）：源资产 + 目标标准 + 首个 DRAFT 版本（含映射项）。
 * 转换白名单/参数/目标数据元校验在服务层统一收口。
 */
public record CreateMappingSetRequest(
        @NotBlank String code,
        @NotBlank String name,
        @NotBlank String sourceAsset,
        @NotBlank String dataset,
        @NotBlank String standardId,
        @Valid List<ItemContract> items) {

    public record ItemContract(
            @NotBlank String sourceColumn,
            @NotBlank String targetElementCode,
            @NotBlank String transform,
            String transformParam,
            String conclusion,
            String note) {
    }
}
