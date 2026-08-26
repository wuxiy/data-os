package com.cywu.dataos.controlplane.ai;

/**
 * AI Ready 引擎未装配（G8 阶段无实现）：build 守护语义的唯一载体，
 * 映射 503 + 错误码 {@code AI_READY_ENGINE_NOT_CONFIGURED}。
 */
public class EngineNotConfiguredException extends RuntimeException {

    public EngineNotConfiguredException() {
        super("AI Ready 评估引擎未接入：G8 阶段仅登记域对象，build 将在 G9 引擎装配后开放");
    }
}
