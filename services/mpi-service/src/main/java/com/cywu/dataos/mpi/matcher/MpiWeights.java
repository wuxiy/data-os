package com.cywu.dataos.mpi.matcher;

import java.util.function.ToDoubleFunction;

/**
 * V2 评分权重与阈值（Fellegi-Sunter m/u，逐比较级估计）。
 *
 * 数值来源：G14 P3 harness 在冻结标定集（services/mpi-service/eval/corpus/
 * calibration.jsonl，生成器 seed 20260828）上的极大似然估计；标定/评测身份
 * 零交集。MpiScoreMatcherTests 会从语料重估并断言与打包值一致——权重漂移
 * （语料再生成或口径变更）会被测试拦下。
 *
 * 语义：m = P(比较级 | 同人)，u = P(比较级 | 非同人)，取自决策层候选对分布
 * （含同名难负样本与卡复用负样本），不是全库随机对分布——FS 框架在候选对
 * 总体上定义 u，这是有意选择，报告已记录口径。
 */
public record MpiWeights(FieldWeights card, FieldWeights name, FieldWeights gender,
                         FieldWeights contact, double tAuto, double tReview,
                         ToDoubleFunction<String> nameUFrequency) {

    /** 单字段三比较级（AGREE / DISAGREE / MISSING）的 m/u。 */
    public record FieldWeights(double mAgree, double uAgree,
                               double mDisagree, double uDisagree,
                               double mMissing, double uMissing) {
    }

    /**
     * 打包权重（2026-08-28 标定定版）：m/u 逐比较级估计自冻结标定集
     * （决策层配比：卡复用 0.60 / 同名孪生 0.12 / 随机对 0.28——锚定真实
     * 45 候选中 B4 占 93% 的构成）。T_AUTO = 零错误 AUTO 约束（max 非同人
     * 分 + 0.01）；T_REVIEW = 同人分数第 1 百分位（复核安全网）。
     * 标定结论（gate 报告详述）：决策层总体上卡号无边际区分度（m≈u），
     * 身份信号在字段合取——纯加性 FS 的 AUTO 召回结构性低于 V1 合取规则，
     * V2 价值在复核排序/负担削减/可解释，决策权保持 V1（影子模式）。
     */
    public static MpiWeights packaged() {
        return new MpiWeights(
                new FieldWeights(0.5265, 0.5965, 0.3673, 0.3656, 0.1061, 0.0379),
                new FieldWeights(1.0000, 0.1249, 0.0000, 0.7453, 0.0000, 0.0000),
                new FieldWeights(0.8366, 0.5277, 0.0000, 0.3116, 0.1634, 0.1607),
                new FieldWeights(0.5028, 0.0084, 0.3953, 0.9081, 0.1020, 0.0835),
                16.54, 0.62,
                null);
    }

    /** 姓名频率 u 细化（322 姓名池）：u_name(n) = freq(n)。未提供时退回全局 u。 */
    public double uNameOf(String nameNorm) {
        double u = nameUFrequency == null ? name.uAgree() : nameUFrequency.applyAsDouble(nameNorm);
        return clamp(u);
    }

    /** 频率表注入的便捷拷贝（评测与测试用）。 */
    public MpiWeights withNameUFrequency(ToDoubleFunction<String> frequency) {
        return new MpiWeights(card, name, gender, contact, tAuto, tReview, frequency);
    }

    public static double clamp(double probability) {
        return Math.clamp(probability, 0.001, 0.999);
    }
}
