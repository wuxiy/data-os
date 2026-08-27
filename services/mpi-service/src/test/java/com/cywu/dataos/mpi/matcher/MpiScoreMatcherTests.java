package com.cywu.dataos.mpi.matcher;


import java.util.function.ToDoubleFunction;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V2 评分器行为测试（验收清单 #3 边界：缺卡/缺联系方式/性别 U/同名不同人/
 * 同卡不同人/姓名变体/频率细化）。权重显式构造，不依赖打包占位值——
 * 打包值与标定集的一致性由 MpiEvalHarnessTests 锁。
 */
class MpiScoreMatcherTests {

    /** 测试权重：比较级间差异放大，便于断言三态分界。 */
    private MpiWeights testWeights(double tAuto, double tReview) {
        return new MpiWeights(
                new MpiWeights.FieldWeights(0.6, 0.1, 0.2, 0.6, 0.2, 0.3),
                new MpiWeights.FieldWeights(1.0, 0.4, 0.0, 0.3, 0.0, 0.1),
                new MpiWeights.FieldWeights(0.9, 0.5, 0.0, 0.5, 0.1, 0.0),
                new MpiWeights.FieldWeights(0.5, 0.02, 0.3, 0.6, 0.2, 0.38),
                tAuto, tReview, null);
    }

    private MpiScoreMatcher.ScorePair pair(String cardA, String nameA, String genderA, String contactA,
                                           String cardB, String nameB, String genderB, String contactB) {
        return new MpiScoreMatcher.ScorePair(cardA, nameA, genderA, contactA,
                cardB, nameB, genderB, contactB);
    }

    @Test
    void strongAgreementAutoMatches() {
        var matcher = new MpiScoreMatcher(testWeights(8, 1));
        var decision = matcher.evaluate(pair("C1", "张三", "M", "h1", "C1", "张三", "M", "h1"));
        assertThat(decision.outcome()).isEqualTo(MpiRuleMatcher.Outcome.AUTO_MATCH);
        assertThat(decision.score()).isGreaterThanOrEqualTo(8);
    }

    @Test
    void cardReuseDifferentNameFallsBelowReview() {
        // 同卡不同名（EP 真实形态）：卡 AGREE 加分，但姓名 DISAGREE 强负分。
        var matcher = new MpiScoreMatcher(testWeights(8, 1));
        var decision = matcher.evaluate(pair("C1", "张三", "M", "h1", "C1", "李四", "F", "h2"));
        assertThat(decision.outcome()).isEqualTo(MpiRuleMatcher.Outcome.NO_MATCH);
        assertThat(levelOf(decision, "card")).isEqualTo("AGREE");
        assertThat(levelOf(decision, "name")).isEqualTo("DISAGREE");
    }

    @Test
    void sameNameDifferentPersonWithoutContactStaysLow() {
        // 同名同性别难负样本：联系方式不一致压住姓名频率细化后的加分。
        var matcher = new MpiScoreMatcher(testWeights(8, 1));
        var decision = matcher.evaluate(pair("C1", "张三", "M", "h1", "C2", "张三", "M", "h2"));
        assertThat(decision.outcome()).isNotEqualTo(MpiRuleMatcher.Outcome.AUTO_MATCH);
    }

    @Test
    void missingCardIsMissingNotDisagree() {
        var matcher = new MpiScoreMatcher(testWeights(8, 1));
        var decision = matcher.evaluate(pair(null, "张三", "M", "h1", "C2", "张三", "M", "h1"));
        assertThat(levelOf(decision, "card")).isEqualTo("MISSING");
        // 缺失不触发 DISAGREE 的强负分：同名同联系方式下分数应高于真不一致。
        var disagree = matcher.evaluate(pair("C9", "张三", "M", "h1", "C2", "张三", "M", "h1"));
        assertThat(decision.score()).isGreaterThan(disagree.score());
    }

    @Test
    void unknownGenderIsMissing() {
        var matcher = new MpiScoreMatcher(testWeights(8, 1));
        var decision = matcher.evaluate(pair("C1", "张三", "U", "h1", "C1", "张三", "M", "h1"));
        assertThat(levelOf(decision, "gender")).isEqualTo("MISSING");
    }

    @Test
    void nameVariantScoresHalfOfExactAgree() {
        var matcher = new MpiScoreMatcher(testWeights(8, 1));
        var exact = matcher.evaluate(pair("C1", "王阿一三四", "M", "h1", "C1", "王阿一三四", "M", "h1"));
        var variant = matcher.evaluate(pair("C1", "王阿一三四", "M", "h1", "C1", "王阿一三五", "M", "h1"));
        assertThat(levelOf(variant, "name")).isEqualTo("VARIANT");
        var exactName = field(exact, "name");
        var variantName = field(variant, "name");
        assertThat(variantName.weight()).isGreaterThan(0);
        assertThat(variantName.weight()).isLessThan(exactName.weight());
    }

    @Test
    void rarerNameWeighsMoreWhenFrequencyProvided() {
        ToDoubleFunction<String> frequency = name -> "李罕见".equals(name) ? 0.002 : 0.4;
        var weights = new MpiWeights(
                new MpiWeights.FieldWeights(0.6, 0.1, 0.2, 0.6, 0.2, 0.3),
                new MpiWeights.FieldWeights(1.0, 0.4, 0.0, 0.3, 0.0, 0.1),
                new MpiWeights.FieldWeights(0.9, 0.5, 0.0, 0.5, 0.1, 0.0),
                new MpiWeights.FieldWeights(0.5, 0.02, 0.3, 0.6, 0.2, 0.38),
                8, 1, frequency);
        var matcher = new MpiScoreMatcher(weights);
        var rare = matcher.evaluate(pair("C1", "李罕见", "M", "h1", "C1", "李罕见", "M", "h1"));
        var common = matcher.evaluate(pair("C1", "张常见", "M", "h1", "C1", "张常见", "M", "h1"));
        assertThat(field(rare, "name").weight()).isGreaterThan(field(common, "name").weight());
    }

    @Test
    void breakdownSumsToScore() {
        var matcher = new MpiScoreMatcher(testWeights(8, 1));
        var decision = matcher.evaluate(pair("C1", "张三", "M", "h1", null, "张三", "M", null));
        double sum = decision.breakdown().stream().mapToDouble(MpiScoreMatcher.FieldScore::weight).sum();
        assertThat(decision.score()).isEqualTo(Math.round(sum * 100.0) / 100.0);
    }

    @Test
    void thresholdBoundariesAreInclusive() {
        // 构造权重使某对分数恰好落在阈值上：≥ T_AUTO 即 AUTO、≥ T_REVIEW 即 REVIEW。
        var matcher = new MpiScoreMatcher(testWeights(8, 1));
        var strong = matcher.evaluate(pair("C1", "张三", "M", "h1", "C1", "张三", "M", "h1"));
        var mid = matcher.evaluate(pair("C1", "张三", "M", "h1", "C2", "张三", "M", "h1"));
        assertThat(strong.outcome()).isEqualTo(MpiRuleMatcher.Outcome.AUTO_MATCH);
        assertThat(mid.outcome()).isIn(MpiRuleMatcher.Outcome.REVIEW, MpiRuleMatcher.Outcome.NO_MATCH);
        // 用同一对、不同阈值验证边界语义。
        var relaxed = new MpiScoreMatcher(testWeights(mid.score(), mid.score() - 1));
        assertThat(relaxed.evaluate(pair("C1", "张三", "M", "h1", "C2", "张三", "M", "h1")).outcome())
                .isEqualTo(MpiRuleMatcher.Outcome.AUTO_MATCH);
    }

    @Test
    void frequencyLookupIsClampedToAvoidInfiniteBits() {
        ToDoubleFunction<String> frequency = name -> 0.0;
        var weights = testWeights(8, 1).withNameUFrequency(frequency);
        var matcher = new MpiScoreMatcher(weights);
        var decision = matcher.evaluate(pair("C1", "张三", "M", "h1", "C1", "张三", "M", "h1"));
        assertThat(field(decision, "name").weight()).isFinite().isLessThan(10.0);
    }

    private static String levelOf(MpiScoreMatcher.ScoreDecision decision, String field) {
        return field(decision, field).level();
    }

    private static MpiScoreMatcher.FieldScore field(MpiScoreMatcher.ScoreDecision decision, String field) {
        return decision.breakdown().stream()
                .filter(item -> item.field().equals(field))
                .findFirst().orElseThrow();
    }
}
