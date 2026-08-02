package com.cywu.dataos.controlplane.job;

import java.util.Map;

public record CreateRunRequest(Map<String, Object> config) {

    public CreateRunRequest {
        config = config == null ? Map.of() : Map.copyOf(config);
    }
}
