package com.cywu.dataos.mpi.matcher;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 规则集 v1 正反例：每条规则的触发与不触发各至少一例（验收清单 #4 的单元层）。 */
class MpiRuleMatcherTests {

    private final MpiRuleMatcher matcher = new MpiRuleMatcher();

    private MatchPair pair(String instA, String pidA, String cardA, String nameA, String genderA,
                           String instB, String pidB, String cardB, String nameB, String genderB) {
        return new MatchPair(new MatchPair.Side(instA, pidA, cardA, nameA, genderA, null),
                new MatchPair.Side(instB, pidB, cardB, nameB, genderB, null));
    }

    @Test
    void mEp1AutoMatchesCrossSourceSamePatientIdWithNameGender() {
        var decision = matcher.evaluate(pair("H1", "9", null, "张三", "M", "H1", "9", "k2", "张三", "M"));
        assertThat(decision.ruleId()).isEqualTo("M-ep1");
        assertThat(decision.outcome()).isEqualTo(Outcome.AUTO_MATCH);
    }

    @Test
    void mEp1DowngradesToReviewWhenNameConflicts() {
        var decision = matcher.evaluate(pair("H1", "9", null, "张三", "M", "H1", "9", "k2", "李四", "M"));
        assertThat(decision.outcome()).isEqualTo(Outcome.REVIEW);
    }

    @Test
    void mEp2AutoMatchesSameCardWithNameGenderSameInstitution() {
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "M", "H1", "2", "C1", "张三", "M"));
        assertThat(decision.ruleId()).isEqualTo("M-ep2");
        assertThat(decision.outcome()).isEqualTo(Outcome.AUTO_MATCH);
    }

    @Test
    void mEp2NeverTriggersAcrossInstitutions() {
        // 跨机构同卡同名：机构锚点缺失不得 AUTO；P-ep1/P-ep2 字面也不覆盖
        // （卡相同但机构不同）——由兜底规则送人工复核。
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "M", "H2", "2", "C1", "张三", "M"));
        assertThat(decision.outcome()).isEqualTo(Outcome.REVIEW);
        assertThat(decision.ruleId()).isEqualTo("P-fallback");
    }

    @Test
    void pEp1SendsCardReuseWithConflictToReview() {
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "M", "H1", "2", "C1", "李四", "F"));
        assertThat(decision.ruleId()).isEqualTo("P-ep1");
        assertThat(decision.outcome()).isEqualTo(Outcome.REVIEW);
    }

    @Test
    void pEp2ReviewsSameNameGenderWithDistinctCards() {
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "M", "H1", "2", "C2", "张三", "M"));
        assertThat(decision.ruleId()).isEqualTo("P-ep2");
        assertThat(decision.outcome()).isEqualTo(Outcome.REVIEW);
    }

    @Test
    void unknownGenderNeverAutoMatches() {
        var decision = matcher.evaluate(pair("H1", "1", "C1", "张三", "U", "H1", "2", "C1", "张三", "U"));
        assertThat(decision.outcome()).isNotEqualTo(Outcome.AUTO_MATCH);
    }

    @Test
    void evidenceMasksCardAndPatientId() {
        var decision = matcher.evaluate(pair("H1", "12345", "441324199003070014", "张三", "M",
                "H1", "67890", "441324199003070014", "李四", "F"));
        var card = decision.evidence().stream()
                .filter(item -> item.field().equals("cardNo")).findFirst().orElseThrow();
        assertThat(card.valueA()).isEqualTo("441324****0014");
        assertThat(card.valueA()).doesNotContain("19900307");
        var pid = decision.evidence().stream()
                .filter(item -> item.field().equals("patientId")).findFirst().orElseThrow();
        assertThat(pid.valueA()).isEqualTo("1***");
    }
}
