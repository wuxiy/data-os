package com.cywu.dataos.controlplane.source;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public record SourceCheckRequest(Map<String, Object> config) {

    public SourceCheckRequest {
        config = config == null
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(config));
    }
}
