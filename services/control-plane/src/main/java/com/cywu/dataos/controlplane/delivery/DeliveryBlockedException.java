package com.cywu.dataos.controlplane.delivery;

import java.util.List;
import java.util.Map;

/**
 * 提交被可交付性检查明确阻断（G25-2）：携带逐项 blockers 供门户渲染阻断清单。
 * 409 语义：状态未变（仍 IN_PROGRESS），修好阻断项后可重试。
 */
public class DeliveryBlockedException extends RuntimeException {

    private final List<Map<String, Object>> blockers;

    public DeliveryBlockedException(String message, List<Map<String, Object>> blockers) {
        super(message);
        this.blockers = List.copyOf(blockers);
    }

    public List<Map<String, Object>> blockers() {
        return blockers;
    }
}
