package com.cywu.dataos.controlplane.edge;

import java.util.Map;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/** 前置机节点登记请求：config 为非敏感白名单键（探测前缀/站点描述等）。 */
public record SaveEdgeNodeRequest(
        @NotBlank(message = "name 不能为空") String name,
        String groupName,
        String site,
        @NotBlank(message = "host 不能为空") String host,
        @NotNull(message = "port 不能为空")
        @Min(value = 1, message = "port 必须在 1-65535")
        @Max(value = 65535, message = "port 必须在 1-65535") Integer port,
        String version,
        Map<String, Object> config) {

    public SaveEdgeNodeRequest {
        config = config == null ? Map.of() : Map.copyOf(config);
    }
}
