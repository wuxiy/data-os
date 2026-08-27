package com.cywu.dataos.mpi.matcher;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToDoubleFunction;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * G14 P3 评测与标定 harness（验收清单 #2/#4/#5/#6 的机器层）。
 *
 * 一、标定：从冻结标定集估计逐比较级 m/u，断言与 MpiWeights.packaged()
 * 一致（锁权重漂移——占位/过期权重会被拦下）。
 * 二、评测：冻结评测集上 V1 规则 vs V2 评分的 P/R/F1 + 混淆矩阵。
 * 三、阈值：确定性规则定版——T_AUTO = 零错误 AUTO 约束下的最大召回
 * （max 非同人分 + 0.01）；T_REVIEW = 同人分数第 1 百分位（复核安全网，
 * 丢失匹配 ≤1%）。扫描表写入 eval/reports/eval-report.json。
 * 四、锚点：4 条人工裁决真实对，V1/V2 判定对照；V2 不得把不同人对判 AUTO。
 *
 * 语料字段见 eval/generate_corpus.py；运行目录为模块根（surefire 默认）。
 */
class MpiEvalHarnessTests {

    private static final Path CORPUS = Path.of("eval", "corpus");
    private static final double EPSILON = 0.005;

    private record Side(String institution, String patientId, String card, String name,
                        String gender, String contactHash) {
    }

    private record Pair(String id, boolean match, String kind, boolean blockingReachable,
                        Side a, Side b) {
    }

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void calibrateEstimateMatchesPackagedWeights() throws IOException {
        var calibration = load(CORPUS.resolve("calibration.jsonl"));
        var frequency = nameFrequency();
        var estimated = estimateWeights(calibration, frequency);
        var packaged = MpiWeights.packaged().withNameUFrequency(frequency);

        assertFieldEquals("card", estimated.card(), packaged.card());
        assertFieldEquals("name", estimated.name(), packaged.name());
        assertFieldEquals("gender", estimated.gender(), packaged.gender());
        assertFieldEquals("contact", estimated.contact(), packaged.contact());
        assertThat(packaged.tAuto()).as("T_AUTO 与阈值扫描定版值一致").isCloseTo(estimated.tAuto(), org.assertj.core.data.Offset.offset(EPSILON));
        assertThat(packaged.tReview()).as("T_REVIEW 与阈值扫描定版值一致").isCloseTo(estimated.tReview(), org.assertj.core.data.Offset.offset(EPSILON));
    }

    @Test
    void evaluationReportCoversV1V2MetricsAndAnchors() throws IOException {
        var evalSet = load(CORPUS.resolve("evalset.jsonl"));
        var frequency = nameFrequency();
        var weights = MpiWeights.packaged().withNameUFrequency(frequency);
        var report = report(evalSet, weights);

        // 安全不变量（验收 #5/#6）：两代算法评测集均零错误 AUTO；人工锚点
        // 不得被 V2 判 AUTO。F1 对比如实记录不硬断言——标定结论是纯加性 FS
        // 的 AUTO 召回结构性低于 V1 合取规则（见 gate 报告），优劣由报告呈现。
        assertThat(report.v1FalseAuto).as("V1 评测集错误 AUTO 必须为 0").isZero();
        assertThat(report.v2FalseAuto).as("V2 评测集错误 AUTO 必须为 0").isZero();
        assertThat(report.anchorViolations).as("锚点错判清单必须为空").isEmpty();

        writeReport(report.node);
    }

    /** 估计 + 阈值定版 + 报告（calibrate 测试复用估计部分）。 */
    private MpiWeights estimateWeights(List<Pair> calibration, ToDoubleFunction<String> frequency) {
        var m = levelRates(calibration, true);
        var u = levelRates(calibration, false);
        var weights = new MpiWeights(
                fieldWeights(m, u, "card"),
                fieldWeights(m, u, "name"),
                fieldWeights(m, u, "gender"),
                fieldWeights(m, u, "contact"),
                0.0, 0.0, frequency);
        var thresholds = calibrateThresholds(calibration, weights);
        return new MpiWeights(fieldWeights(m, u, "card"), fieldWeights(m, u, "name"),
                fieldWeights(m, u, "gender"), fieldWeights(m, u, "contact"),
                thresholds[0], thresholds[1], frequency);
    }

    /** 逐字段×比较级的 m/u 速率（label 侧过滤）。 */
    private Map<String, Map<String, double[]>> levelRates(List<Pair> pairs, boolean matchSide) {
        Map<String, Map<String, long[]>> counts = new LinkedHashMap<>();
        for (var pair : pairs.stream().filter(p -> p.match() == matchSide).toList()) {
            tally(counts, "card", MpiScoreMatcher.level(pair.a().card(), pair.b().card()));
            tally(counts, "name", MpiScoreMatcher.nameLevel(pair.a().name(), pair.b().name()));
            tally(counts, "gender", MpiScoreMatcher.genderLevel(pair.a().gender(), pair.b().gender()));
            tally(counts, "contact", MpiScoreMatcher.level(pair.a().contactHash(), pair.b().contactHash()));
        }
        Map<String, Map<String, double[]>> rates = new LinkedHashMap<>();
        counts.forEach((field, levels) -> {
            long total = levels.values().stream().mapToLong(c -> c[0]).sum();
            Map<String, double[]> fieldRates = new LinkedHashMap<>();
            levels.forEach((level, count) ->
                    fieldRates.put(level, new double[] {count[0] == 0 ? 0.0 : (double) count[0] / total}));
            rates.put(field, fieldRates);
        });
        return rates;
    }

    private static void tally(Map<String, Map<String, long[]>> counts, String field,
                              MpiScoreMatcher.Level level) {
        counts.computeIfAbsent(field, f -> new LinkedHashMap<>())
                .computeIfAbsent(level.name(), l -> new long[1])[0]++;
    }

    private MpiWeights.FieldWeights fieldWeights(Map<String, Map<String, double[]>> m,
                                                 Map<String, Map<String, double[]>> u,
                                                 String field) {
        return new MpiWeights.FieldWeights(
                rate(m, field, "AGREE"), rate(u, field, "AGREE"),
                rate(m, field, "DISAGREE"), rate(u, field, "DISAGREE"),
                rate(m, field, "MISSING"), rate(u, field, "MISSING"));
    }

    private static double rate(Map<String, Map<String, double[]>> rates, String field, String level) {
        return rates.getOrDefault(field, Map.of()).getOrDefault(level, new double[] {0.0})[0];
    }

    /** 阈值定版（确定性）：见类注释三。返回 [tAuto, tReview]。 */
    private double[] calibrateThresholds(List<Pair> calibration, MpiWeights weights) {
        var matcher = new MpiScoreMatcher(weights);
        var matchScores = new ArrayList<Double>();
        double maxNonMatch = Double.NEGATIVE_INFINITY;
        for (var pair : calibration) {
            double score = matcher.evaluate(toScorePair(pair)).score();
            if (pair.match()) {
                matchScores.add(score);
            } else {
                maxNonMatch = Math.max(maxNonMatch, score);
            }
        }
        matchScores.sort(Comparator.naturalOrder());
        double tAuto = round2(maxNonMatch + 0.01);
        int lostAllowed = matchScores.size() / 100;   // ≤1% 同人对允许落 NO_MATCH
        double tReview = matchScores.isEmpty() ? tAuto
                : round2(matchScores.get(Math.min(lostAllowed, matchScores.size() - 1)));
        return new double[] {tAuto, tReview};
    }

    private record Report(ObjectNode node, int v1FalseAuto, double v1F1, int v2FalseAuto,
                          double v2F1, List<String> anchorViolations) {
    }

    private Report report(List<Pair> evalSet, MpiWeights weights) throws IOException {
        var ruleMatcher = new MpiRuleMatcher();
        var scoreMatcher = new MpiScoreMatcher(weights);
        var v1 = new Confusion("V1 规则");
        var v2 = new Confusion("V2 评分");
        int positivesBlockingReachable = 0;
        for (var pair : evalSet) {
            if (pair.match() && pair.blockingReachable()) positivesBlockingReachable++;
            v1.record(pair.match(), ruleMatcher.evaluate(toRuleAttributes(pair)).outcome());
            v2.record(pair.match(), scoreMatcher.evaluate(toScorePair(pair)).outcome());
        }
        var anchors = anchors();
        var violations = new ArrayList<String>();
        var anchorRows = json.createArrayNode();
        for (var anchor : anchors) {
            var v1Outcome = ruleMatcher.evaluate(toRuleAttributes(anchor.pair())).outcome();
            var v2Outcome = scoreMatcher.evaluate(toScorePair(anchor.pair())).outcome();
            if (!anchor.match() && v2Outcome == MpiRuleMatcher.Outcome.AUTO_MATCH) {
                violations.add(anchor.id());
            }
            var row = anchorRows.addObject();
            row.put("id", anchor.id());
            row.put("human", anchor.match() ? "SAME_PERSON" : "DIFFERENT_PERSON");
            row.put("v1", v1Outcome.name());
            row.put("v2", v2Outcome.name());
        }

        var node = json.createObjectNode();
        node.put("corpus", "eval/corpus/evalset.jsonl (seed 20260828)");
        node.set("v1", v1.toJson(json));
        node.set("v2", v2.toJson(json));
        node.put("positivesBlockingReachable", positivesBlockingReachable);
        node.put("positives", evalSet.stream().filter(Pair::match).count());
        node.set("anchors", anchorRows);
        var thresholds = json.createObjectNode();
        thresholds.put("tAuto", weights.tAuto());
        thresholds.put("tReview", weights.tReview());
        node.set("thresholds", thresholds);
        node.set("tAutoSensitivity", sensitivitySweep(evalSet, weights));
        return new Report(node, v1.falseAuto, v1.f1(), v2.falseAuto, v2.f1(), violations);
    }

    /** T_AUTO 敏感度：放宽错误 AUTO 允许量 k 时的召回/负担变化（诚实呈现
     *  零误并约束的代价曲线；生产策略仍取 k=0）。 */
    private ArrayNode sensitivitySweep(List<Pair> evalSet, MpiWeights weights) {
        var matcher = new MpiScoreMatcher(weights);
        var matchScores = new ArrayList<Double>();
        var nonMatchScores = new ArrayList<Double>();
        for (var pair : evalSet) {
            double score = matcher.evaluate(toScorePair(pair)).score();
            (pair.match() ? matchScores : nonMatchScores).add(score);
        }
        matchScores.sort(Comparator.reverseOrder());
        nonMatchScores.sort(Comparator.reverseOrder());
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

        void record(boolean match, MpiRuleMatcher.Outcome outcome) {
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

    private void writeReport(ObjectNode node) throws IOException {
        var dir = Path.of("eval", "reports");
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("eval-report.json"),
                json.writerWithDefaultPrettyPrinter().writeValueAsString(node) + "\n");
    }

    private List<Pair> load(Path path) throws IOException {
        var pairs = new ArrayList<Pair>();
        for (String line : Files.readAllLines(path)) {
            var node = json.readTree(line);
            pairs.add(new Pair(
                    node.get("id").asText(),
                    "MATCH".equals(node.get("label").asText()),
                    node.get("kind").asText(),
                    node.get("blockingReachable").asBoolean(),
                    side(node.get("a")), side(node.get("b"))));
        }
        assertThat(pairs).isNotEmpty();
        return pairs;
    }

    private record Anchor(String id, boolean match, Pair pair) {
    }

    private List<Anchor> anchors() throws IOException {
        var anchors = new ArrayList<Anchor>();
        for (String line : Files.readAllLines(CORPUS.resolve("anchors.jsonl"))) {
            var node = json.readTree(line);
            boolean same = "SAME_PERSON".equals(node.get("resolution").asText());
            String id = "anchor-" + node.get("pairId").asText();
            anchors.add(new Anchor(id, same,
                    new Pair(id, same, "human-anchor", false,
                            side(node.get("a")), side(node.get("b")))));
        }
        return anchors;
    }

    private ToDoubleFunction<String> nameFrequency() throws IOException {
        Map<String, Integer> counts = new HashMap<>();
        int total = 0;
        for (String line : Files.readAllLines(CORPUS.resolve("snapshot.jsonl"))) {
            var node = json.readTree(line);
            counts.merge(node.get("name").asText(), 1, Integer::sum);
            total++;
        }
        assertThat(total).isGreaterThan(0);
        final int denominator = total;
        Map<String, Double> frozen = new HashMap<>();
        counts.forEach((name, count) -> frozen.put(name, (double) count / denominator));
        return name -> frozen.getOrDefault(name, frozen.values().stream()
                .mapToDouble(Double::doubleValue).average().orElse(0.4));
    }

    private static Side side(JsonNode node) {
        return new Side(node.get("institution").asText(null), node.get("patientId").asText(null),
                nullsToNull(node.get("card")), node.get("name").asText(null),
                nullsToNull(node.get("gender")), nullsToNull(node.get("contactHash")));
    }

    /** JSON null → Java null（缺失语义在比较级里承载）。 */
    private static String nullsToNull(JsonNode node) {
        return node == null || node.isNull() ? null : node.asText();
    }

    private static MpiRuleMatcher.PairAttributes toRuleAttributes(Pair pair) {
        var a = pair.a();
        var b = pair.b();
        boolean contactSame = a.contactHash() != null && a.contactHash().equals(b.contactHash());
        return new MpiRuleMatcher.PairAttributes(a.institution(), a.patientId(), a.card(), a.name(),
                a.gender(), contactSame, b.institution(), b.patientId(), b.card(), b.name(),
                b.gender());
    }

    private static MpiScoreMatcher.ScorePair toScorePair(Pair pair) {
        var a = pair.a();
        var b = pair.b();
        return new MpiScoreMatcher.ScorePair(a.card(), a.name(), a.gender(), a.contactHash(),
                b.card(), b.name(), b.gender(), b.contactHash());
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
