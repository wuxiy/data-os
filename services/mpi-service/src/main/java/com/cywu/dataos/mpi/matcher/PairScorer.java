package com.cywu.dataos.mpi.matcher;

/**
 * 匹配引擎 seam：两代引擎（V1 确定性规则 / V2 Fellegi-Sunter 评分）的
 * 统一输入（MatchPair）与结果口径（PairDecision）。生产决策编排与评测
 * harness 经此多态消费、适配只写一份；V2 转正（合取守卫 + 分数的混合
 * 策略）时换实现即换决策权，不动胶水。
 */
public interface PairScorer {

    /** 引擎版本标识（"v1" / "v2-fs"），进 match_result 与评测报告。 */
    String version();

    /** 评估候选对；明细（规则证据 / 分数分解）由返回的具体类型承载。 */
    PairDecision evaluate(MatchPair pair);
}
