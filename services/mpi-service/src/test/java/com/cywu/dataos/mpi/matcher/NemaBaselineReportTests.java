package com.cywu.dataos.mpi.matcher;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * nema 实战基线对拍（G2G 批次 6）：一代 empi 修正规则 + 双阈值的
 * data-os 重写（NemaBaselineComparator）在冻结标定集 + 评测集 + 人工
 * 锚点上与 T5 混合引擎逐对对拍，产出覆盖率/一致率/分歧矩阵与分歧样本
 * （掩码快照）。报告落 eval/reports/nema-baseline-report.json（入 Git 作
 * gate 证据，先例 eval-report.json）。
 *
 * 分歧不设通过阈值（首轮如实产出）；权重调整走 T5b 重标定纪律，对拍
 * 分歧只记调优候选（gate 文档承载），不在本测试内改参数。
 */
class NemaBaselineReportTests {

    private static final Path CORPUS = Path.of("eval", "corpus");
    private static final Path REPORT = Path.of("eval", "reports", "nema-baseline-report.json");
    private static final int MAX_SAMPLES = 20;

    private final MpiCorpus corpus = new MpiCorpus();
    private final ObjectMapper json = new ObjectMapper();

    /** 对拍单元：语料来源 + 对 id + 真值 + nema 带/规则 + T5 三态/规则带 + 掩码字段快照。 */
    private record Row(String source, String pairId, boolean truth,
                       NemaBaselineComparator.NemaBand nema, String nemaRule,
                       Outcome t5, String t5Rule, String masked) {
    }

    @Test
    void crossChecksNemaBaselineAgainstHybridEngine() throws IOException {
        var frequency = corpus.nameFrequency(CORPUS.resolve("snapshot.jsonl"));
        var weights = MpiWeights.packaged().withNameUFrequency(frequency);
        var hybrid = new MpiHybridMatcher(new MpiRuleMatcher(), new MpiScoreMatcher(weights), weights.tVeto());
        var baseline = new NemaBaselineComparator();

        var rows = new ArrayList<Row>();
        rows.addAll(crossCheck("calibration", corpus.load(CORPUS.resolve("calibration.jsonl")), baseline, hybrid));
        rows.addAll(crossCheck("evalset", corpus.load(CORPUS.resolve("evalset.jsonl")), baseline, hybrid));
        rows.addAll(crossCheck("anchors", corpus.anchors(CORPUS).stream()
                .map(anchor -> new MpiCorpus.Pair(anchor.id(), anchor.match(), "human-anchor", false,
                        anchor.pair().a(), anchor.pair().b()))
                .toList(), baseline, hybrid));

        var covered = rows.stream().filter(row -> row.nema() != NemaBaselineComparator.NemaBand.UNCOVERED).toList();
        var agreed = covered.stream().filter(NemaBaselineReportTests::agrees).count();
        var matrix = matrix(covered);
        var disagreements = covered.stream()
                .filter(row -> !agrees(row))
                .map(row -> sample(row, rows.indexOf(row)))
                .limit(MAX_SAMPLES)
                .toList();

        var report = report(rows.size(), covered.size(), agreed, matrix, ruleBreakdown(covered), disagreements);
        Files.createDirectories(REPORT.getParent());
        Files.writeString(REPORT, json.writerWithDefaultPrettyPrinter().writeValueAsString(report) + "\n");

        // 断言锁全量覆盖与报告完备性：矩阵行和=覆盖数、样本数封顶、三带语料均有覆盖。
        var matrixSum = matrix.values().stream().mapToLong(Long::longValue).sum();
        assertThat(matrixSum).as("分歧矩阵行和 = 覆盖样本数").isEqualTo(covered.size());
        assertThat(rows.size()).as("对拍总量 = 标定 + 评测 + 锚点").isGreaterThan(covered.size());
        assertThat(covered.size()).as("规则可判定覆盖非空").isPositive();
        assertThat(disagreements.size()).isLessThanOrEqualTo(MAX_SAMPLES);
        assertThat(matrix.keySet()).contains(
                "LINK→AUTO_MATCH", "SUSPECT→REVIEW", "DIFFERENT→NO_MATCH");
    }

    private static List<Row> crossCheck(String source, List<MpiCorpus.Pair> pairs,
                                        NemaBaselineComparator baseline, MpiHybridMatcher hybrid) {
        var rows = new ArrayList<Row>();
        for (var pair : pairs) {
            var matchPair = pair.toMatchPair();
            var nema = baseline.evaluate(matchPair);
            var decision = hybrid.evaluate(matchPair);
            rows.add(new Row(source, pair.id(), pair.match(), nema.band(), nema.ruleId(),
                    decision.outcome(), decision.ruleId(), masked(matchPair)));
        }
        return rows;
    }

    /** nema 规则 × T5 规则带的分解（调优素材：分歧集中在哪条守卫）。 */
    private static LinkedHashMap<String, Long> ruleBreakdown(List<Row> covered) {
        var breakdown = new LinkedHashMap<String, Long>();
        covered.stream()
                .collect(java.util.stream.Collectors.groupingBy(
                        row -> row.nemaRule() + "→" + row.t5Rule(),
                        java.util.LinkedHashMap::new,
                        java.util.stream.Collectors.counting()))
                .forEach(breakdown::put);
        return breakdown;
    }

    /** 带语义对照：LINK↔AUTO_MATCH、SUSPECT↔REVIEW、DIFFERENT↔NO_MATCH。 */
    private static boolean agrees(Row row) {
        return switch (row.nema()) {
            case LINK -> row.t5() == Outcome.AUTO_MATCH;
            case SUSPECT -> row.t5() == Outcome.REVIEW;
            case DIFFERENT -> row.t5() == Outcome.NO_MATCH;
            case UNCOVERED -> false;
        };
    }

    private static LinkedHashMap<String, Long> matrix(List<Row> covered) {
        var matrix = new LinkedHashMap<String, Long>();
        for (var nema : NemaBaselineComparator.NemaBand.values()) {
            if (nema == NemaBaselineComparator.NemaBand.UNCOVERED) continue;
            for (var outcome : new Outcome[]{Outcome.AUTO_MATCH, Outcome.REVIEW, Outcome.NO_MATCH}) {
                matrix.put(nema + "→" + outcome, covered.stream()
                        .filter(row -> row.nema() == nema && row.t5() == outcome)
                        .count());
            }
        }
        return matrix;
    }

    private ObjectNode sample(Row row, int index) {
        var node = json.createObjectNode();
        node.put("index", index);
        node.put("source", row.source());
        node.put("pairId", row.pairId());
        node.put("truth", row.truth());
        node.put("nemaBand", row.nema().name());
        node.put("t5Outcome", row.t5().name());
        node.put("fields", row.masked());
        return node;
    }

    private ObjectNode report(int total, int covered, long agreed,
                              LinkedHashMap<String, Long> matrix, LinkedHashMap<String, Long> ruleBreakdown,
                              List<ObjectNode> disagreements) {
        var node = json.createObjectNode();
        node.put("date", "2026-10-05");
        node.put("batch", "G2G-6 nema 实战基线对拍");
        node.put("nemaParams", "linkTh=0.9 suspectTh=0.5（empi-algo AlgoConstants 默认值）");
        node.put("rules", "SAME_XM_ZJHM / SAME_XM_LXFS / SAME_ZJHM_LXFS(退化:无出生日期) / DIFF_ZJHM_XM");
        node.put("t5Params", "T5b 重锚定版权重（MpiWeights.packaged），tVeto=-1.09");
        node.put("totalPairs", total);
        node.put("coveredPairs", covered);
        node.put("agreedPairs", agreed);
        node.put("agreementRate", covered == 0 ? 0.0 : (double) agreed / covered);
        var matrixNode = node.putObject("matrix");
        matrix.forEach(matrixNode::put);
        var ruleNode = node.putObject("ruleBreakdown");
        ruleBreakdown.entrySet().stream()
                .sorted(java.util.Map.Entry.<String, Long>comparingByValue().reversed())
                .forEach(entry -> ruleNode.put(entry.getKey(), entry.getValue()));
        var samples = node.putArray("disagreements");
        disagreements.stream().limit(MAX_SAMPLES).forEach(samples::add);
        var candidates = node.putArray("tuningCandidates");
        appendCandidate(candidates, matrix, "LINK→NO_MATCH",
                "nema 判关联而 T5 否决/拒绝——检查 tVeto 是否误伤规则可判定的真人对（重标定候选）");
        appendCandidate(candidates, matrix, "DIFFERENT→AUTO_MATCH",
                "nema 判不同而 T5 自动合并——检查合取守卫是否过宽（红线级，须人工复核样本）");
        return node;
    }

    private static void appendCandidate(ArrayNode candidates, LinkedHashMap<String, Long> matrix,
                                        String cell, String note) {
        if (matrix.getOrDefault(cell, 0L) > 0) {
            var item = candidates.addObject();
            item.put("cell", cell);
            item.put("count", matrix.get(cell));
            item.put("note", note);
        }
    }

    /** 掩码字段快照（证件掩码与规则层同款；联系方式本就是哈希）。 */
    private static String masked(MatchPair pair) {
        return "card=%s|%s name=%s|%s gender=%s|%s contact=%s|%s".formatted(
                MpiRuleMatcher.maskCard(pair.a().card()), MpiRuleMatcher.maskCard(pair.b().card()),
                pair.a().name(), pair.b().name(),
                pair.a().gender(), pair.b().gender(),
                pair.a().contactHash() == null ? "-" : "set", pair.b().contactHash() == null ? "-" : "set");
    }
}
