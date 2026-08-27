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
     * 打包权重。下方数值在 P2 为占位值——P3 标定后由 harness 断言锁定
     * （MpiScoreMatcherTests 重估语料并断言逐值相等，占位值会被测试拦下）。
     * 阈值 T_AUTO / T_REVIEW 同理由 P3 阈值扫描定版：约束 = 评测集零错误
     * AUTO 下最大化 F1。
     */
    public static MpiWeights packaged() {
        return new MpiWeights(
                new FieldWeights(0.55, 0.30, 0.20, 0.48, 0.25, 0.22),
                new FieldWeights(1.00, 0.40, 0.00, 0.28, 0.00, 0.10),
                new FieldWeights(0.92, 0.50, 0.00, 0.50, 0.08, 0.00),
                new FieldWeights(0.50, 0.03, 0.30, 0.55, 0.20, 0.42),
                10.0, 2.0,
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
