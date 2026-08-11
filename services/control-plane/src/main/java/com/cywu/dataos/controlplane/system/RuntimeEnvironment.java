package com.cywu.dataos.controlplane.system;

import java.util.Locale;
import java.util.Set;

/**
 * The runtime environment is a security boundary, not an arbitrary label.
 * Unknown values fail closed instead of accidentally taking a development
 * or production branch.
 */
public final class RuntimeEnvironment {

    private static final Set<String> SUPPORTED = Set.of("development", "test", "production");

    private RuntimeEnvironment() {
    }

    public static String normalize(String value) {
        var normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!SUPPORTED.contains(normalized)) {
            throw new IllegalStateException(
                    "DATAOS_RUNTIME_ENV 仅支持 development、test 或 production，当前值：" + value);
        }
        return normalized;
    }

    public static boolean isProduction(String value) {
        return "production".equals(normalize(value));
    }
}
