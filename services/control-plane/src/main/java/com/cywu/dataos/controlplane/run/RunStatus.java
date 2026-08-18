package com.cywu.dataos.controlplane.run;

import java.util.Locale;
import java.util.Set;

/**
 * 外部运行的统一状态词汇（领域定义见 CONTEXT.md「外部运行」）。
 *
 * <p>数据库列仍以字符串存储，取值为枚举名。执行器各自的厂商状态词
 * 由适配器归一为本词汇之后，才进入生命周期模块。</p>
 */
public enum RunStatus {
    SUBMITTING, SUBMITTED, RUNNING, SUCCEEDED, FAILED, CANCELED,
    UNKNOWN, SUBMIT_FAILED,
    BLOCKED_CONFIGURATION, BLOCKED_DEPENDENCY, UNSUPPORTED_EXECUTOR;

    private static final Set<RunStatus> TERMINAL = Set.of(
            SUCCEEDED, FAILED, CANCELED, SUBMIT_FAILED,
            BLOCKED_CONFIGURATION, BLOCKED_DEPENDENCY, UNSUPPORTED_EXECUTOR);

    /** 允许人工再次发起的既往终态集合（采集侧重试入口的准入判断）。 */
    public static final Set<String> RETRYABLE_TERMINAL = Set.of(
            "FAILED", "CANCELED", "BLOCKED_CONFIGURATION", "BLOCKED_DEPENDENCY",
            "SUBMIT_FAILED", "UNSUPPORTED_EXECUTOR", "UNKNOWN");

    public boolean terminal() {
        return TERMINAL.contains(this);
    }

    public static boolean isTerminal(String status) {
        var value = exact(status);
        return value != null && value.terminal();
    }

    /**
     * 执行器别名到统一词汇的归一：已归一的中性值原样通过，未知值归为
     * UNKNOWN。每个执行器的厂商词表归一留在各自适配器内，这里只兜住
     * 适配器泄漏的中性别名。
     */
    public static RunStatus normalize(String status) {
        if (status == null) return UNKNOWN;
        return switch (status.trim().toUpperCase(Locale.ROOT)) {
            case "SUBMITTED", "PENDING", "QUEUED" -> SUBMITTED;
            case "RUNNING", "STARTED" -> RUNNING;
            case "SUCCEEDED", "SUCCESS", "PASSED", "FINISHED" -> SUCCEEDED;
            case "FAILED", "ERROR" -> FAILED;
            case "CANCELED", "CANCELLED", "STOPPED" -> CANCELED;
            default -> exact(status) == null ? UNKNOWN : exact(status);
        };
    }

    /** 严格白名单：仅接受已归一的枚举名，其余（含别名）归为 UNKNOWN。 */
    public static RunStatus sanitized(String status) {
        var value = exact(status);
        return value == null ? UNKNOWN : value;
    }

    private static RunStatus exact(String status) {
        if (status == null) return null;
        try {
            return valueOf(status.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }
}
