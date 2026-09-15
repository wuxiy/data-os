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

    /**
     * 构建执行面（G18）：按 Recipe 真实执行构建（引擎 POST /build），返回
     * chunk 数 / RustFS 版本 / 质量统计。调用方负责仅在 recipeRef 可解析时调用。
     */
    java.util.Map<String, Object> construct(AIDataProduct product, String recipeRef);

    /**
     * 对当前版本语料执行 RAG 评测（G11），返回五指标报告。
     * recipeRef（G17 双产品契约）：当前版本登记的 Recipe 引用，引擎据此解析
     * 语料表与评测集；空值回落引擎默认（合成语料口径）。
     */
    java.util.Map<String, Object> evaluate(AIDataProduct product, String recipeRef);
}
