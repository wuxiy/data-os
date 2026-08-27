package com.cywu.dataos.controlplane.dataservice;

import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 创建数据服务请求。参数契约与列契约为轻量 JSON 结构：
 * <pre>
 * parameters: [{"name":"start_date","type":"date","required":true,"description":"..."}]
 * columns:    [{"name":"visit_date","type":"date","description":"..."}]
 * </pre>
 * 参数 type 仅允许 string / number / date / boolean。
 */
public record CreateDataServiceRequest(
        @NotBlank @Size(max = 64) @Pattern(regexp = "^[a-z][a-z0-9-]*$",
                message = "code 须为小写字母开头的 slug") String code,
        @NotBlank @Size(max = 128) String name,
        @NotBlank @Size(max = 2000) String description,
        @NotBlank @Size(max = 4000) String sqlTemplate,
        @NotEmpty List<@Valid ParameterContract> parameters,
        @NotEmpty List<@Valid ColumnContract> columns,
        @Min(1) @Max(10000) int maxRows,
        @Min(1) @Max(120) int timeoutSeconds,
        @NotBlank @Size(max = 64) String owner) {

    public record ParameterContract(
            @NotBlank @Pattern(regexp = "^[A-Za-z_][A-Za-z0-9_]*$") String name,
            @NotBlank @Pattern(regexp = "string|number|date|boolean",
                    message = "参数 type 仅允许 string/number/date/boolean") String type,
            boolean required,
            @Size(max = 500) String description,
            List<String> values,
            String defaultValue) {
    }

    public record ColumnContract(
            @NotBlank String name,
            @NotBlank String type,
            @Size(max = 500) String description) {
    }
}
