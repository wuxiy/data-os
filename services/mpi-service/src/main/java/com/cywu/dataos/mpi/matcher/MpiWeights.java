package com.cywu.dataos.mpi.matcher;

import java.util.function.ToDoubleFunction;

/**
 * V2 评分权重与阈值（Fellegi-Sunter m/u，逐比较级估计）。tVeto 是 T5 混合
 * 策略的否决下限（与 tAuto/tReview 同源标定，由混合引擎消费，V2 纯评分
 * 不用它）。
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
                         FieldWeights contact, double tAuto, double tReview, double tVeto,
                         ToDoubleFunction<String> nameUFrequency) {

    /** 单字段三比较级（AGREE / DISAGREE / MISSING）的 m/u。 */
    public record FieldWeights(double mAgree, double uAgree,
                               double mDisagree, double uDisagree,
                               double mMissing, double uMissing) {
    }

    /**
     * 打包权重（2026-09-03 §四重标定定版，T5b 弱多源）：m/u 逐比较级估计自
     * 重锚冻结标定集（负样本配比 0.74/0.18/0.08 锚定双流真实决策层构成
     * B4:B6=0.81:0.19；正样本含 720 对跨流真实对——m 侧首次吃到真实跨流
     * 一致率：name.mAgree 0.804、gender.mDisagree 0.152、card.mMissing 0.700
     * 为结构性缺失）。T_AUTO = 零错误 AUTO 约束（max 非同人分 + 0.01）；
     * T_REVIEW = 同人分数第 1 百分位；T_VETO = 标定集 min 同人分 − 0.01
     * （零误否约束）——0.42→-1.09 的深移修复了单源标定 tVeto 对跨流真人
     * 对的误否（实证 anchor-1569541917，见 docs/validation/t5b-reanchor-
     * 20260903.md）。T_AUTO 取全冻结语料联合安全界（标定集 max 非同人
     * 17.59 + 评测集孪生 17.61）+ 0.01 = 17.62——m/u 仍纯标定集估计。
     * 决策结构结论不变：身份信号在字段合取，守卫先于分数。
     */
    public static MpiWeights packaged() {
        return new MpiWeights(
                new FieldWeights(0.1713, 0.3741, 0.1287, 0.1008, 0.7000, 0.5250),
                new FieldWeights(0.8042, 0.1846, 0.0227, 0.6603, 0.0000, 0.0000),
                new FieldWeights(0.7444, 0.5132, 0.1523, 0.3373, 0.1032, 0.1495),
                new FieldWeights(0.6648, 0.0052, 0.2648, 0.9040, 0.0704, 0.0908),
                17.62, -0.01, -1.09,
                null);
    }

    /** 姓名频率 u 细化（322 姓名池）：u_name(n) = freq(n)。未提供时退回全局 u。 */
    public double uNameOf(String nameNorm) {
        double u = nameUFrequency == null ? name.uAgree() : nameUFrequency.applyAsDouble(nameNorm);
        return clamp(u);
    }

    /** 频率表注入的便捷拷贝（评测与测试用）。 */
    public MpiWeights withNameUFrequency(ToDoubleFunction<String> frequency) {
        return new MpiWeights(card, name, gender, contact, tAuto, tReview, tVeto, frequency);
    }

    public static double clamp(double probability) {
        return Math.clamp(probability, 0.001, 0.999);
    }
}
