package com.cywu.dataos.mpi.matcher;

import java.util.List;

/**
 * V2 概率评分器（Fellegi-Sunter，影子模式）。G14 方案
 * docs/mpi-g14-review-and-plan-20260828.md §三。
 *
 * score = Σ 字段比较级权重（bit）：AGREE → log2(m/u)，DISAGREE →
 * log2((1-m)/(1-u)) 的逐级形式（m/u 按比较级直接估计，见 MpiWeights），
 * MISSING → log2(m_miss/u_miss)（缺失率两总体相同则自然趋 0 = 无信息）。
 * 姓名变体（JW ≥ 0.9）权重 = 0.5 × AGREE 权重（启发式：语料无变体，
 * 无法标定，如实标注）。机构不进加权：V1 阻断层全部同机构，是范围前提
 * 而非证据字段。
 *
 * 决策（双阈值三态）：score ≥ T_AUTO → AUTO_MATCH；≥ T_REVIEW → REVIEW；
 * 否则 NO_MATCH。Hard Constraint（人工否决/拆分）在编排层前置，高于分数。
 */
public final class MpiScoreMatcher implements PairScorer {

    public static final String SCORE_VERSION = "v2-fs";

    /** 评分明细：逐字段比较级与权重（证据透明，进 evidence JSON）。 */
    public record FieldScore(String field, String level, double weight) {
    }

    public record ScoreDecision(double score, Outcome outcome,
                                List<FieldScore> breakdown) implements PairDecision {
    }

    public enum Level { AGREE, VARIANT, DISAGREE, MISSING }

    private final MpiWeights weights;

    public MpiScoreMatcher(MpiWeights weights) {
        this.weights = weights;
    }

    @Override
    public String version() {
        return SCORE_VERSION;
    }

    @Override
    public ScoreDecision evaluate(MatchPair pair) {
        var a = pair.a();
        var b = pair.b();
        var breakdown = List.of(
                fieldScore("card", level(a.card(), b.card()), weights.card()),
                nameScore(a.name(), b.name()),
                fieldScore("gender", genderLevel(a.gender(), b.gender()), weights.gender()),
                fieldScore("contact", level(a.contactHash(), b.contactHash()), weights.contact()));
        double score = Math.round(breakdown.stream().mapToDouble(FieldScore::weight).sum() * 100.0) / 100.0;
        var outcome = score >= weights.tAuto() ? Outcome.AUTO_MATCH
                : score >= weights.tReview() ? Outcome.REVIEW
                : Outcome.NO_MATCH;
        return new ScoreDecision(score, outcome, breakdown);
    }

    private FieldScore fieldScore(String field, Level level, MpiWeights.FieldWeights fieldWeights) {
        double weight = switch (level) {
            case AGREE -> bits(fieldWeights.mAgree(), fieldWeights.uAgree());
            case DISAGREE -> bits(fieldWeights.mDisagree(), fieldWeights.uDisagree());
            case MISSING -> bits(fieldWeights.mMissing(), fieldWeights.uMissing());
            case VARIANT -> throw new IllegalStateException("仅姓名字段有变体比较级: " + field);
        };
        return new FieldScore(field, level.name(), round(weight));
    }

    private FieldScore nameScore(String a, String b) {
        Level level = nameLevel(a, b);
        if (level == Level.AGREE || level == Level.VARIANT) {
            // 姓名频率细化：u 随具体姓名取值（322 姓名池，常用名证据更弱）。
            double u = weights.uNameOf(a);
            double agree = bits(weights.name().mAgree(), u);
            double weight = level == Level.AGREE ? agree : agree * 0.5;
            return new FieldScore("name", level.name(), round(weight));
        }
        return fieldScore("name", level, weights.name());
    }

    /** 姓名比较级：缺失 / 精确一致 / JW 变体 / 不一致（harness 标定复用）。 */
    static Level nameLevel(String a, String b) {
        if (a == null || a.isBlank() || b == null || b.isBlank()) return Level.MISSING;
        if (a.equals(b)) return Level.AGREE;
        return JaroWinkler.isVariant(a, b) ? Level.VARIANT : Level.DISAGREE;
    }

    /** 缺失感知比较：一侧空 = MISSING；双侧非空相等 = AGREE；否则 DISAGREE。 */
    static Level level(String a, String b) {
        if (a == null || b == null) return Level.MISSING;
        return a.equals(b) ? Level.AGREE : Level.DISAGREE;
    }

    static Level genderLevel(String a, String b) {
        if (a == null || b == null || "U".equals(a) || "U".equals(b)) return Level.MISSING;
        return a.equals(b) ? Level.AGREE : Level.DISAGREE;
    }

    private static double bits(double m, double u) {
        return Math.log(MpiWeights.clamp(m) / MpiWeights.clamp(u)) / Math.log(2);
    }

    private static double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
