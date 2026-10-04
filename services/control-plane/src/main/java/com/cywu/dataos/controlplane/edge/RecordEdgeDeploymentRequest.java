package com.cywu.dataos.controlplane.edge;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 发布登记请求：version 必填；artifactRef/note 可选（描述性，非制品本体）。 */
public record RecordEdgeDeploymentRequest(
        @NotBlank(message = "version 不能为空") @Size(max = 64, message = "version 过长") String version,
        @Size(max = 300, message = "artifactRef 过长") String artifactRef,
        @Size(max = 500, message = "note 过长") String note) {
}
