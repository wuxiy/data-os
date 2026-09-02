package com.cywu.dataos.mpi.matcher;

/**
 * T5 混合策略引擎（V1 合取守卫 + V2 分数否决）。G14 核心结论：EP 字段集上
 * 身份信号在字段合取不在边际——V1 合取规则零误并自动化率 0.44，纯加性 FS
 * 仅 0.02；V2 的可兑现价值是非同人复核负担削减与正确的 NO_MATCH 处置。
 * 据此混合形态：
 *
 * - AUTO 判定权完全归 V1 合取守卫（M-ep1/M-ep2），分数不守门——dev 实测
 *   同卡但联系方式不一致的真实同人 AUTO 对落在 V2 低分带（7.2-8.8 bit），
 *   用分数守门会把 V1 的自动化降回去。
 * - 否决带：V1 判 REVIEW/NO_MATCH 的对，若 V2 分数低于 tVeto（标定集
 *   min 同人分 − 0.01，零误否约束）→ 直接 NO_MATCH，免除复核任务。
 *   典型目标：P-ep1 卡复用对（同卡 + 姓名冲突，分数约 -10 bit）。
 * - Hard Constraint（H-ep1/H-ep2）在编排层前置，高于本引擎（见
 *   MpiDecisionService）。
 */
public final class MpiHybridMatcher implements PairScorer {

    public static final String HYBRID_VERSION = "v1+v2";

    /** 混合决策：V1 规则带 + V2 总分 + 否决是否触发（进影子证据）。 */
    public record HybridDecision(String ruleId, Outcome outcome, double score, boolean vetoed)
            implements PairDecision {
    }

    private final MpiRuleMatcher rules;
    private final MpiScoreMatcher scores;
    private final double tVeto;

    public MpiHybridMatcher(MpiRuleMatcher rules, MpiScoreMatcher scores, double tVeto) {
        this.rules = rules;
        this.scores = scores;
        this.tVeto = tVeto;
    }

    @Override
    public String version() {
        return HYBRID_VERSION;
    }

    @Override
    public HybridDecision evaluate(MatchPair pair) {
        var rule = rules.evaluate(pair);
        double score = scores.evaluate(pair).score();
        if (rule.outcome() != Outcome.AUTO_MATCH && score < tVeto) {
            return new HybridDecision(rule.ruleId() + "/V2-VETO", Outcome.NO_MATCH, score, true);
        }
        return new HybridDecision(rule.ruleId(), rule.outcome(), score, false);
    }
}
