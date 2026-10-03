package com.cywu.dataos.controlplane.source;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** 连接登记请求：config 形状与可用性检查同构（jdbcUrl / username / credentialRef）。 */
public record SourceConnectionRequest(Map<String, Object> config) {

    public SourceConnectionRequest {
        config = config == null
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(config));
    }
}
