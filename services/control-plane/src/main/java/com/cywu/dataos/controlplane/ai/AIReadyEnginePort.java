package com.cywu.dataos.controlplane.ai;

/**
 * AI Ready 评估引擎端口（G9 落地实现；G8 仅定义契约）。
 *
 * <p>控制面经此端口把「构建/评估」委托给引擎服务；端口未装配时
 * build 守护返回 503（不把登记请求冒充构建成功）。</p>
 */
public interface AIReadyEnginePort {

    /** 对指定产品的当前版本执行就绪度评估，返回结论投影（含完整报告）。 */
    AIReadyAssessment build(AIDataProduct product, String recipeRef);
}
