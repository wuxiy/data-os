package com.cywu.dataos.controlplane.standard;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;

/**
 * 创建数据标准（G22）：同时创建标准集合与首个 DRAFT 版本（version_no=1）。
 * elements 的类型/值域校验在服务层统一收口（错误文案带元素定位）。
 */
public record CreateStandardRequest(
        @NotBlank String code,
        @NotBlank String name,
        String description,
        String owner,
        @Valid List<ElementContract> elements) {

    public record ElementContract(
            @NotBlank String code,
            @NotBlank String name,
            @NotBlank String dataType,
            boolean required,
            String definition,
            String sensitivity,
            String assetRef,
            @Valid List<ValueContract> values) {
    }

    public record ValueContract(
            @NotBlank String code,
            @NotBlank String displayName,
            String validFrom,
            String validTo) {
    }
}
