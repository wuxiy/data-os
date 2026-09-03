package com.cywu.dataos.mpi.matcher;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToDoubleFunction;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * G14 P3 评测与标定 harness（验收清单 #2/#4/#5/#6 的机器层）。
 *
 * 一、标定：从冻结标定集估计逐比较级 m/u，断言与 MpiWeights.packaged()
 * 一致（锁权重漂移——占位/过期权重会被拦下）。
 * 二、评测：冻结评测集上 V1 规则 vs V2 评分 vs T5 混合（守卫 + 否决带）
 * 的 P/R/F1 + 混淆矩阵。
 * 三、阈值：确定性规则定版——T_AUTO = 零错误 AUTO 约束下的最大召回
 * （max 非同人分 + 0.01）；T_REVIEW = 同人分数第 1 百分位（复核安全网，
 * 丢失匹配 ≤1%）；T_VETO = min 同人分 − 0.01（零误否约束，混合专用）。
 * 扫描表写入 eval/reports/eval-report.json。
 * 四、锚点：4 条人工裁决真实对，各引擎判定对照；V2 不得把不同人对判 AUTO。
 *
 * 语料字段见 eval/generate_corpus.py；运行目录为模块根（surefire 默认）。
 * 估计数学的单一属主是 MpiWeightEstimator（T5b 漂移检测共用）。
 */
class MpiEvalHarnessTests {

    private static final Path CORPUS = Path.of("eval", "corpus");
    private static final double EPSILON = 0.005;

    private final MpiCorpus corpus = new MpiCorpus();
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void calibrateEstimateMatchesPackagedWeights() throws IOException {
        var calibration = corpus.load(CORPUS.resolve("calibration.jsonl"));
        var evalSet = corpus.load(CORPUS.resolve("evalset.jsonl"));
        var frequency = corpus.nameFrequency(CORPUS.resolve("snapshot.jsonl"));
        var estimated = new MpiWeightEstimator(frequency).estimate(labeled(calibration), labeled(evalSet));
        var packaged = MpiWeights.packaged().withNameUFrequency(frequency);

        assertFieldEquals("card", estimated.card(), packaged.card());
        assertFieldEquals("name", estimated.name(), packaged.name());
        assertFieldEquals("gender", estimated.gender(), packaged.gender());
        assertFieldEquals("contact", estimated.contact(), packaged.contact());
        assertThat(packaged.tAuto()).as("T_AUTO 与阈值扫描定版值一致").isCloseTo(estimated.tAuto(), org.assertj.core.data.Offset.offset(EPSILON));
        assertThat(packaged.tReview()).as("T_REVIEW 与阈值扫描定版值一致").isCloseTo(estimated.tReview(), org.assertj.core.data.Offset.offset(EPSILON));
        assertThat(packaged.tVeto()).as("T_VETO 与标定定版值一致（min 同人 - 0.01）").isCloseTo(estimated.tVeto(), org.assertj.core.data.Offset.offset(EPSILON));
    }

    @Test
    void evaluationReportCoversAllEnginesMetricsAndAnchors() throws IOException {
        var evalSet = corpus.load(CORPUS.resolve("evalset.jsonl"));
        var frequency = corpus.nameFrequency(CORPUS.resolve("snapshot.jsonl"));
        var weights = MpiWeights.packaged().withNameUFrequency(frequency);
        var report = report(evalSet, weights);

        // 安全不变量：各引擎评测集零错误 AUTO；V2 不把人工锚点的不同人对
        // 判 AUTO；T5 混合零误否（否决带不得吞掉任何同人对）。F1 对比如实
        // 记录不硬断言——标定结论是纯加性 FS 的 AUTO 召回结构性低于 V1
        // 合取规则（见 gate 报告），优劣由报告呈现。
        assertThat(report.confusions().get("v1").falseAuto).as("V1 评测集错误 AUTO 必须为 0").isZero();
        assertThat(report.confusions().get("v2").falseAuto).as("V2 评测集错误 AUTO 必须为 0").isZero();
        assertThat(report.confusions().get("hybrid").falseAuto)
                .as("混合引擎错误 AUTO 必须为 0（AUTO 完全继承 V1 守卫）").isZero();
        assertThat(report.confusions().get("hybrid").matchNoMatch)
                .as("混合引擎零误否：否决带不得把同人对判 NO_MATCH").isZero();
        assertThat(report.anchorViolations).as("锚点错判清单必须为空").isEmpty();

        writeReport(report.node());
    }

    private static List<MpiWeightEstimator.LabeledPair> labeled(List<MpiCorpus.Pair> pairs) {
        return pairs.stream()
                .map(p -> new MpiWeightEstimator.LabeledPair(p.match(), p.toMatchPair()))
                .toList();
    }

    /** 参评引擎（报告键 / 标签 / seam 实现），加引擎只加一行。 */
    private record Engine(String key, String label, PairScorer scorer) {
    }

    private Report report(List<MpiCorpus.Pair> evalSet, MpiWeights weights) throws IOException {
        var engines = List.of(
                new Engine("v1", "V1 规则", new MpiRuleMatcher()),
                new Engine("v2", "V2 评分", new MpiScoreMatcher(weights)),
                new Engine("hybrid", "V1+V2 混合", new MpiHybridMatcher(
                        new MpiRuleMatcher(), new MpiScoreMatcher(weights), weights.tVeto())));
        int positivesBlockingReachable = 0;
        for (var pair : evalSet) {
            if (pair.match() && pair.blockingReachable()) positivesBlockingReachable++;
        }
        var confusions = new LinkedHashMap<String, Confusion>();
        for (var engine : engines) {
            var confusion = new Confusion(engine.label());
            for (var pair : evalSet) {
                confusion.record(pair.match(), engine.scorer().evaluate(pair.toMatchPair()).outcome());
            }
            confusions.put(engine.key(), confusion);
        }

        var anchors = corpus.anchors(CORPUS);
        var violations = new ArrayList<String>();
        var anchorRows = json.createArrayNode();
        for (var anchor : anchors) {
            var row = anchorRows.addObject();
            row.put("id", anchor.id());
            row.put("human", anchor.match() ? "SAME_PERSON" : "DIFFERENT_PERSON");
            for (var engine : engines) {
                var outcome = engine.scorer().evaluate(anchor.pair().toMatchPair()).outcome();
                row.put(engine.key(), outcome.name());
                // 安全不变量只锁 V2：评分器不得把不同人锚点判 AUTO。
                if ("v2".equals(engine.key()) && !anchor.match() && outcome == Outcome.AUTO_MATCH) {
                    violations.add(anchor.id());
                }
            }
        }

        var node = json.createObjectNode();
        node.put("corpus", "eval/corpus/evalset.jsonl (seed 20260828)");
        confusions.forEach((key, confusion) -> node.set(key, confusion.toJson(json)));
        node.put("positivesBlockingReachable", positivesBlockingReachable);
        node.put("positives", evalSet.stream().filter(MpiCorpus.Pair::match).count());
        node.set("anchors", anchorRows);
        var thresholds = json.createObjectNode();
        thresholds.put("tAuto", weights.tAuto());
        thresholds.put("tReview", weights.tReview());
        thresholds.put("tVeto", weights.tVeto());
        node.set("thresholds", thresholds);
        node.set("tAutoSensitivity", sensitivitySweep(evalSet, weights));
        node.set("tVetoSensitivity", vetoSensitivitySweep(evalSet, weights));
        return new Report(node, confusions, violations);
    }

    /** T_AUTO 敏感度：放宽错误 AUTO 允许量 k 时的召回/负担变化（诚实呈现
     *  零误并约束的代价曲线；生产策略仍取 k=0）。 */
    private ArrayNode sensitivitySweep(List<MpiCorpus.Pair> evalSet, MpiWeights weights) {
        var matcher = new MpiScoreMatcher(weights);
        var matchScores = new ArrayList<Double>();
        var nonMatchScores = new ArrayList<Double>();
        for (var pair : evalSet) {
            double score = matcher.evaluate(pair.toMatchPair()).score();
            (pair.match() ? matchScores : nonMatchScores).add(score);
        }
        matchScores.sort(java.util.Comparator.reverseOrder());
        nonMatchScores.sort(java.util.Comparator.reverseOrder());
        var sweep = json.createArrayNode();
        for (int allowedFalseAuto : new int[] {0, 1, 2, 5}) {
            double tAuto = allowedFalseAuto == 0
                    ? round2(nonMatchScores.get(0) + 0.01)
                    : round2(nonMatchScores.get(Math.min(allowedFalseAuto, nonMatchScores.size() - 1)));
            long auto = matchScores.stream().filter(s -> s >= tAuto).count();
            long review = matchScores.stream().filter(s -> s >= weights.tReview() && s < tAuto).count();
            var row = sweep.addObject();
            row.put("allowedFalseAuto", allowedFalseAuto);
            row.put("tAuto", tAuto);
            row.put("matchAuto", auto);
            row.put("matchReview", review);
            row.put("autoRecall", round2((double) auto / matchScores.size()));
        }
        return sweep;
    }

    /** T_VETO 敏感度：否决下限取不同值时的误否（同人对被否决掉）与复核
     *  减免（非同人被免除）——诚实呈现零误否约束下的负担削减曲线。 */
    private ArrayNode vetoSensitivitySweep(List<MpiCorpus.Pair> evalSet, MpiWeights weights) {
        var rules = new MpiRuleMatcher();
        var scorer = new MpiScoreMatcher(weights);
        record Row(boolean match, Outcome v1, double score) {
        }
        var rows = new ArrayList<Row>();
        for (var pair : evalSet) {
            rows.add(new Row(pair.match(), rules.evaluate(pair.toMatchPair()).outcome(),
                    scorer.evaluate(pair.toMatchPair()).score()));
        }
        double calibrated = weights.tVeto();
        var candidates = new double[] {weights.tReview(), 0, -2, -4, -6, -8, -10, -12, calibrated};
        var sweep = json.createArrayNode();
        for (double tVeto : candidates) {
            int matchVetoed = 0;
            int nonMatchRelieved = 0;
            int nonMatchReview = 0;
            for (var row : rows) {
                boolean vetoed = row.v1() != Outcome.AUTO_MATCH && row.score() < tVeto;
                if (row.match()) {
                    if (vetoed) matchVetoed++;
                } else if (row.v1() == Outcome.REVIEW) {
                    if (vetoed) nonMatchRelieved++;
                    else nonMatchReview++;
                }
            }
            var entry = sweep.addObject();
            entry.put("tVeto", round2(tVeto));
            entry.put("calibrated", tVeto == calibrated);
            entry.put("matchVetoed", matchVetoed);
            entry.put("nonMatchReviewRelieved", nonMatchRelieved);
            entry.put("nonMatchSentToReview", nonMatchReview);
        }
        return sweep;
    }

    /** 三态混淆：AUTO 视为正预测；REVIEW 是安全网（另行计负担）。 */
    private static final class Confusion {
        private final String name;
        private int tp;
        private int falseAuto;
        private int matchReview;
        private int matchNoMatch;
        private int nonMatchReview;
        private int nonMatchNoMatch;

        Confusion(String name) {
            this.name = name;
        }

        void record(boolean match, Outcome outcome) {
            if (match) {
                switch (outcome) {
                    case AUTO_MATCH -> tp++;
                    case REVIEW -> matchReview++;
                    default -> matchNoMatch++;
                }
            } else {
                switch (outcome) {
                    case AUTO_MATCH -> falseAuto++;
                    case REVIEW -> nonMatchReview++;
                    default -> nonMatchNoMatch++;
                }
            }
        }

        double precision() {
            int predicted = tp + falseAuto;
            return predicted == 0 ? 1.0 : (double) tp / predicted;
        }

        double recall() {
            int actual = tp + matchReview + matchNoMatch;
            return actual == 0 ? 0.0 : (double) tp / actual;
        }

        double f1() {
            double p = precision();
            double r = recall();
            return p + r == 0 ? 0.0 : 2 * p * r / (p + r);
        }

        ObjectNode toJson(ObjectMapper json) {
            var node = json.createObjectNode();
            node.put("engine", name);
            node.put("autoTp", tp);
            node.put("autoFalse", falseAuto);
            node.put("matchSentToReview", matchReview);
            node.put("matchLostNoMatch", matchNoMatch);
            node.put("nonMatchSentToReview", nonMatchReview);
            node.put("nonMatchNoMatch", nonMatchNoMatch);
            node.put("autoPrecision", round2(precision()));
            node.put("autoRecall", round2(recall()));
            node.put("f1", round2(f1()));
            return node;
        }
    }

    private record Report(ObjectNode node, Map<String, Confusion> confusions,
                          List<String> anchorViolations) {
    }

    private void writeReport(ObjectNode node) throws IOException {
        var dir = Path.of("eval", "reports");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("eval-report.json"),
                json.writerWithDefaultPrettyPrinter().writeValueAsString(node) + "\n");
    }

    private void assertFieldEquals(String field, MpiWeights.FieldWeights estimated,
                                   MpiWeights.FieldWeights packaged) {
        assertThat(packaged.mAgree()).as(field + " mAgree").isCloseTo(estimated.mAgree(), org.assertj.core.data.Offset.offset(EPSILON));
        assertThat(packaged.uAgree()).as(field + " uAgree").isCloseTo(estimated.uAgree(), org.assertj.core.data.Offset.offset(EPSILON));
        assertThat(packaged.mDisagree()).as(field + " mDisagree").isCloseTo(estimated.mDisagree(), org.assertj.core.data.Offset.offset(EPSILON));
        assertThat(packaged.uDisagree()).as(field + " uDisagree").isCloseTo(estimated.uDisagree(), org.assertj.core.data.Offset.offset(EPSILON));
        assertThat(packaged.mMissing()).as(field + " mMissing").isCloseTo(estimated.mMissing(), org.assertj.core.data.Offset.offset(EPSILON));
        assertThat(packaged.uMissing()).as(field + " uMissing").isCloseTo(estimated.uMissing(), org.assertj.core.data.Offset.offset(EPSILON));
    }

    private static double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
