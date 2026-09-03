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
        return estimate(calibration, List.of());
    }

    /**
     * 全流程估计（安全审计口径，2026-09-03 §四重标定引入）：m/u 与 T_REVIEW
     * 百分位仍纯标定集；零误并/零误否两条安全界（T_AUTO 上界、T_VETO 下界）
     * 取标定集 ∪ 安全审计集（冻结语料的评测集）——安全界保守化不污染估计，
     * 否则评测集孪生负样本（实测 17.61）会越过纯标定界（17.60）产生误并。
     */
    public MpiWeights estimate(List<LabeledPair> calibration, List<LabeledPair> safetyAudit) {
        var m = levelRates(calibration, true);
        var u = levelRates(calibration, false);
        var fields = List.of("card", "name", "gender", "contact");
        // 打包口径对齐：m/u 先取 4 位小数（与 MpiWeights.packaged 同精度），
        // 阈值用取整后的权重推导——否则边界对分数漂移会让「估计器定版值」与
        // 「打包权重实测行为」相差 0.01-0.02（2026-09-03 实测），锁值断言必炸。
        var card = round4(fieldWeights(m, u, "card"));
        var name = round4(fieldWeights(m, u, "name"));
        var gender = round4(fieldWeights(m, u, "gender"));
        var contact = round4(fieldWeights(m, u, "contact"));
        var zeroed = new MpiWeights(card, name, gender, contact, 0.0, 0.0, 0.0, nameFrequency);
        double[] thresholds = calibrateThresholds(calibration, safetyAudit, zeroed);
        return new MpiWeights(card, name, gender, contact,
                thresholds[0], thresholds[1], thresholds[2], nameFrequency);
    }

    private static MpiWeights.FieldWeights round4(MpiWeights.FieldWeights w) {
        return new MpiWeights.FieldWeights(round(w.mAgree()), round(w.uAgree()),
                round(w.mDisagree()), round(w.uDisagree()),
                round(w.mMissing()), round(w.uMissing()));
    }

    private static double round(double value) {
        return Math.round(value * 10000.0) / 10000.0;
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

    /** 阈值定版：见类注释。安全界取标定 ∪ 审计；返回 [tAuto, tReview, tVeto]。 */
    private double[] calibrateThresholds(List<LabeledPair> calibration, List<LabeledPair> safetyAudit,
                                         MpiWeights weights) {
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
        // 安全审计：只并入零误并/零误否两条界（同人最低分与非同人最高分），
        // 不参与 T_REVIEW 百分位——那是标定集的召回旋钮。
        double auditMinSame = Double.POSITIVE_INFINITY;
        for (var labeled : safetyAudit) {
            double score = matcher.evaluate(labeled.pair()).score();
            if (labeled.match()) {
                auditMinSame = Math.min(auditMinSame, score);
            } else {
                maxNonMatch = Math.max(maxNonMatch, score);
            }
        }
        matchScores.sort(Comparator.naturalOrder());
        double tAuto = round2(maxNonMatch + 0.01);
        int lostAllowed = matchScores.size() / 100;
        double tReview = matchScores.isEmpty() ? tAuto
                : round2(matchScores.get(Math.min(lostAllowed, matchScores.size() - 1)));
        double calMinSame = matchScores.isEmpty() ? Double.POSITIVE_INFINITY : matchScores.get(0);
        double tVeto = round2(Math.min(calMinSame, auditMinSame) - 0.01);
        return new double[] {tAuto, tReview, tVeto};
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
