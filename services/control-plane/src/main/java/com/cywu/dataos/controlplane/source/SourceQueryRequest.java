package com.cywu.dataos.controlplane.source;

/** 受控查询请求：单条 SELECT/WITH；行数上限服务端封顶。 */
public record SourceQueryRequest(String sql, String catalog, Integer maxRows) {
}
