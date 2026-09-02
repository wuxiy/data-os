package com.cywu.dataos.mpi.matcher;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToDoubleFunction;

/**
 * m/u 与阈值的确定性估计器（G14 标定 / T5b 漂移检测共用，语义唯一）。
 *
 * 输入带标签的候选对（决策层构成：含同名难负与卡复用负样本），输出逐字段
 * ×比较级的 m/u 与三阈值。阈值定版规则（确定性）：T_AUTO = max 非同人分 +
 * 0.01（零误并）；T_REVIEW = 同人分第 1 百分位（复核安全网，丢失 ≤1%）；
 * T_VETO = min 同人分 − 0.01（零误否）。语料与生成器假设见
 * eval/generate_corpus.py 与 docs/mpi-recalibration-runbook.md。
 */
public final class MpiWeightEstimator {

    /** 带标签候选对（估计的最小输入面）。 */
    public record LabeledPair(boolean match, MatchPair pair) {
    }

    /** 逐字段×比较级计数。 */
    private record Tally(Map<String, Map<String, long[]>> counts) {
    }

    private final ToDoubleFunction<String> nameFrequency;

    public MpiWeightEstimator(ToDoubleFunction<String> nameFrequency) {
        this.nameFrequency = nameFrequency;
    }

    /** 全流程估计：m/u → 零阈值权重 → 阈值定版 → 完整权重。 */
    public MpiWeights estimate(List<LabeledPair> calibration) {
        var m = levelRates(calibration, true);
        var u = levelRates(calibration, false);
        var fields = List.of("card", "name", "gender", "contact");
        var zeroed = new MpiWeights(
                fieldWeights(m, u, "card"), fieldWeights(m, u, "name"),
                fieldWeights(m, u, "gender"), fieldWeights(m, u, "contact"),
                0.0, 0.0, 0.0, nameFrequency);
        double[] thresholds = calibrateThresholds(calibration, zeroed);
        return new MpiWeights(
                fieldWeights(m, u, "card"), fieldWeights(m, u, "name"),
                fieldWeights(m, u, "gender"), fieldWeights(m, u, "contact"),
                thresholds[0], thresholds[1], thresholds[2], nameFrequency);
    }

    private Tally levelRates(List<LabeledPair> pairs, boolean matchSide) {
        Map<String, Map<String, long[]>> counts = new LinkedHashMap<>();
        for (var labeled : pairs.stream().filter(p -> p.match() == matchSide).toList()) {
            var pair = labeled.pair();
            var a = pair.a();
            var b = pair.b();
            tally(counts, "card", MpiScoreMatcher.level(a.card(), b.card()));
            tally(counts, "name", MpiScoreMatcher.nameLevel(a.name(), b.name()));
            tally(counts, "gender", MpiScoreMatcher.genderLevel(a.gender(), b.gender()));
            tally(counts, "contact", MpiScoreMatcher.level(a.contactHash(), b.contactHash()));
        }
        return new Tally(counts);
    }

    private static void tally(Map<String, Map<String, long[]>> counts, String field,
                              MpiScoreMatcher.Level level) {
        counts.computeIfAbsent(field, f -> new LinkedHashMap<>())
                .computeIfAbsent(level.name(), l -> new long[1])[0]++;
    }

    private MpiWeights.FieldWeights fieldWeights(Tally m, Tally u, String field) {
        return new MpiWeights.FieldWeights(
                rate(m, field, "AGREE"), rate(u, field, "AGREE"),
                rate(m, field, "DISAGREE"), rate(u, field, "DISAGREE"),
                rate(m, field, "MISSING"), rate(u, field, "MISSING"));
    }

    private static double rate(Tally tally, String field, String level) {
        var levels = tally.counts().getOrDefault(field, Map.of());
        long total = levels.values().stream().mapToLong(c -> c[0]).sum();
        if (total == 0) {
            return 0.0;
        }
        long count = levels.getOrDefault(level, new long[1])[0];
        return (double) count / total;
    }

    /** 阈值定版：见类注释。返回 [tAuto, tReview, tVeto]。 */
    private double[] calibrateThresholds(List<LabeledPair> calibration, MpiWeights weights) {
        var matcher = new MpiScoreMatcher(weights);
        var matchScores = new ArrayList<Double>();
        double maxNonMatch = Double.NEGATIVE_INFINITY;
        for (var labeled : calibration) {
            double score = matcher.evaluate(labeled.pair()).score();
            if (labeled.match()) {
                matchScores.add(score);
            } else {
                maxNonMatch = Math.max(maxNonMatch, score);
            }
        }
        matchScores.sort(Comparator.naturalOrder());
        double tAuto = round2(maxNonMatch + 0.01);
        int lostAllowed = matchScores.size() / 100;
        double tReview = matchScores.isEmpty() ? tAuto
                : round2(matchScores.get(Math.min(lostAllowed, matchScores.size() - 1)));
        double tVeto = matchScores.isEmpty() ? Double.NEGATIVE_INFINITY
                : round2(matchScores.get(0) - 0.01);
        return new double[] {tAuto, tReview, tVeto};
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
