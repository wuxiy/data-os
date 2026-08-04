package com.cywu.dataos.controlplane.job;

import java.util.Locale;
import java.util.Set;

import com.cywu.dataos.controlplane.api.InvalidRequestException;

final class JobLifecycle {

    static final String DRAFT = "DRAFT";
    static final String ACTIVE = "ACTIVE";
    static final String PAUSED = "PAUSED";
    static final String ARCHIVED = "ARCHIVED";
    static final Set<String> STATUSES = Set.of(DRAFT, ACTIVE, PAUSED, ARCHIVED);

    private JobLifecycle() {
    }

    static String normalize(String status) {
        var normalized = status == null ? "" : status.trim().toUpperCase(Locale.ROOT);
        if (!STATUSES.contains(normalized)) {
            throw new InvalidRequestException("不支持的任务状态：" + status);
        }
        return normalized;
    }
}
