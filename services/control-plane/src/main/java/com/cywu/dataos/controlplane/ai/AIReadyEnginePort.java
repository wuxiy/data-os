package com.cywu.dataos.controlplane.ai;

/**
 * AI Ready 评估引擎端口（G9 落地实现；G8 仅定义契约）。
 *
 * <p>控制面经此端口把「构建/评估」委托给引擎服务；端口未装配时
 * build 守护返回 503（不把登记请求冒充构建成功）。</p>
 */
public interface AIReadyEnginePort {

    /** 对指定产品版本执行构建登记与就绪度评估，返回引擎侧运行标识。 */
    String build(AIDataProduct product, String recipeRef);
}
