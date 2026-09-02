package com.cywu.dataos.mpi.matcher;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * T5 混合引擎行为测试：否决带触发/不触发、V1 守卫高于分数（AUTO 不被
 * 低分降级）、版本标识。权重显式构造（数值推导见各用例注释）。
 */
class MpiHybridMatcherTests {

    private final MpiRuleMatcher rules = new MpiRuleMatcher();
    private final MpiScoreMatcher scores = new MpiScoreMatcher(weights());

    /** 与 MpiScoreMatcherTests 同款测试权重：P-ep1 卡复用对分数约 -15.6、
     *  M-ep2 同卡同名对约 +9.4、P-ep2 同名异卡（缺联系）约 -0.3。 */
    private static MpiWeights weights() {
        return new MpiWeights(
                new MpiWeights.FieldWeights(0.6, 0.1, 0.2, 0.6, 0.2, 0.3),
                new MpiWeights.FieldWeights(1.0, 0.4, 0.0, 0.3, 0.0, 0.1),
                new MpiWeights.FieldWeights(0.9, 0.5, 0.0, 0.5, 0.1, 0.0),
                new MpiWeights.FieldWeights(0.5, 0.02, 0.3, 0.6, 0.2, 0.38),
                8, 1, -10, null);
    }

    private static MatchPair pair(String instA, String pidA, String cardA, String nameA, String genderA,
                                  String contactA, String instB, String pidB, String cardB, String nameB,
                                  String genderB, String contactB) {
        return new MatchPair(
                new MatchPair.Side(instA, pidA, cardA, nameA, genderA, contactA),
                new MatchPair.Side(instB, pidB, cardB, nameB, genderB, contactB));
    }

    @Test
    void vetoSendsCardReuseReviewPairToNoMatch() {
        // P-ep1（同卡 + 姓名性别冲突）分数约 -15.6 < tVeto(-10)：否决触发。
        var matcher = new MpiHybridMatcher(rules, scores, -10);
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "M", "h1",
                "H1", "2", "C1", "李四", "F", "h2"));
        assertThat(decision.outcome()).isEqualTo(Outcome.NO_MATCH);
        assertThat(decision.vetoed()).isTrue();
        assertThat(decision.ruleId()).isEqualTo("P-ep1/V2-VETO");
    }

    @Test
    void reviewPairSurvivesAboveVetoThreshold() {
        // P-ep2（同名异卡缺联系）分数约 -0.3 > tVeto(-10)：复核安全网不动。
        var matcher = new MpiHybridMatcher(rules, scores, -10);
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "M", null,
                "H1", "2", "C2", "张三", "M", null));
        assertThat(decision.outcome()).isEqualTo(Outcome.REVIEW);
        assertThat(decision.vetoed()).isFalse();
        assertThat(decision.ruleId()).isEqualTo("P-ep2");
    }

    @Test
    void conjunctionGuardsWinOverScoreForAutoPairs() {
        // M-ep2（同卡同名同性别同联系）分数约 +9.4，但 tVeto=100 迫使分数
        // 远低于阈值——守卫仍须 AUTO：真实同人可能落在低分带，分数不守门。
        var matcher = new MpiHybridMatcher(rules, scores, 100);
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "M", "h1",
                "H1", "2", "C1", "张三", "M", "h1"));
        assertThat(decision.outcome()).isEqualTo(Outcome.AUTO_MATCH);
        assertThat(decision.vetoed()).isFalse();
        assertThat(decision.score()).isLessThan(100);
    }

    @Test
    void carriesBothEngineIdentity() {
        var matcher = new MpiHybridMatcher(rules, scores, -10);
        assertThat(matcher.version()).isEqualTo("v1+v2");
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "M", "h1",
                "H1", "2", "C2", "张三", "M", null));
        assertThat(decision.ruleId()).isEqualTo("P-ep2");
        assertThat(decision.score()).isNegative();
    }
}
