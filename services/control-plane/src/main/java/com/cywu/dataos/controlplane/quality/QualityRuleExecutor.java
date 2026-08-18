package com.cywu.dataos.controlplane.quality;

import java.util.Optional;

public interface QualityRuleExecutor {

    boolean supports(String executor);

    /**
     * 该执行器在当前配置下是否可用。「配置成什么样才算配置好」的知识
     * 归执行器自己（HTTP 看地址、DEMO 看开关），门户状态与运维平台
     * 探针都经此询问，不再各自重复推导。
     */
    default boolean configured() {
        return true;
    }

    /**
     * 就绪探测端点；无 HTTP 面的执行器返回空，由 {@link #configured()}
     * 直接决定就绪态。
     */
    default Optional<String> readinessEndpoint() {
        return Optional.empty();
    }

    QualityRuleSubmission submit(QualityRuleExecutionRequest request);

    QualityRuleExecutionStatus status(String externalId);
}
