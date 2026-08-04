package com.cywu.dataos.controlplane.source;

import java.util.Map;

public interface SourceCheckAdapter {

    boolean supports(String protocol);

    SourceCheckResult check(Source source, Map<String, Object> config);
}
