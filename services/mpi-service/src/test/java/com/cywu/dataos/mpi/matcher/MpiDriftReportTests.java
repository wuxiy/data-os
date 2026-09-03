package com.cywu.dataos.mpi.matcher;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * T5b 漂移检测（报告式，不锁死）：对一份**新导出**的语料重估 m/u 与三阈值，
 * 与 MpiWeights.packaged() 逐项对比，输出漂移报告——超差只报告不失败，
 * 是否重标定（更新 packaged + 跑全量锁死）是人工决策，流程见
 * docs/mpi-recalibration-runbook.md。
 *
 * 运行（模块根，corpus 目录含 calibration.jsonl + snapshot.jsonl）：
 *   mvn test -Dtest=MpiDriftReportTests -Ddrift.corpus=/path/to/corpus
 * 报告落 eval/reports/drift-report.json（不入 Git）。
 */
@EnabledIfSystemProperty(named = "drift.corpus", matches = ".+")
class MpiDriftReportTests {

    /** 与 harness 锁断言同容差：≤ε 视为未漂移。 */
    private static final double EPSILON = 0.005;

    private final MpiCorpus corpus = new MpiCorpus();
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void driftReportComparingFreshEstimateWithPackaged() throws IOException {
        var dir = Path.of(System.getProperty("drift.corpus"));
        var calibration = corpus.load(dir.resolve("calibration.jsonl"));
        var evalSet = corpus.load(dir.resolve("evalset.jsonl"));
        var frequency = corpus.nameFrequency(dir.resolve("snapshot.jsonl"));
        var estimated = new MpiWeightEstimator(frequency).estimate(
                calibration.stream()
                        .map(p -> new MpiWeightEstimator.LabeledPair(p.match(), p.toMatchPair()))
                        .toList(),
                evalSet.stream()
                        .map(p -> new MpiWeightEstimator.LabeledPair(p.match(), p.toMatchPair()))
                        .toList());
        var packaged = MpiWeights.packaged().withNameUFrequency(frequency);
        assertThat(calibration).isNotEmpty();

        var node = json.createObjectNode();
        node.put("date", LocalDate.now().toString());
        node.put("corpus", dir.toString());
        node.put("calibrationPairs", calibration.size());
        var fields = node.putArray("fields");
        int drifted = 0;
        drifted += fieldRow(fields, "card", estimated.card(), packaged.card());
        drifted += fieldRow(fields, "name", estimated.name(), packaged.name());
        drifted += fieldRow(fields, "gender", estimated.gender(), packaged.gender());
        drifted += fieldRow(fields, "contact", estimated.contact(), packaged.contact());
        var thresholds = node.putArray("thresholds");
        drifted += thresholdRow(thresholds, "tAuto", estimated.tAuto(), packaged.tAuto());
        drifted += thresholdRow(thresholds, "tReview", estimated.tReview(), packaged.tReview());
        drifted += thresholdRow(thresholds, "tVeto", estimated.tVeto(), packaged.tVeto());
        node.put("driftedItems", drifted);
        node.put("verdict", drifted == 0 ? "STABLE" : "DRIFT");
        node.put("tolerance", EPSILON);
        node.put("note", "报告式：超差不失败；重标定流程见 docs/mpi-recalibration-runbook.md");

        var out = Path.of("eval", "reports", "drift-report.json");
        Files.createDirectories(out.getParent());
        Files.writeString(out, json.writerWithDefaultPrettyPrinter().writeValueAsString(node) + "\n");
        System.out.println("[drift] verdict=" + node.get("verdict").asText()
                + " drifted=" + drifted + "/" + (4 * 6 + 3) + " -> " + out);
    }

    /** 返回漂移项数（0/1）。 */
    private int fieldRow(ArrayNode fields, String name, MpiWeights.FieldWeights estimated,
                         MpiWeights.FieldWeights packaged) {
        var row = fields.addObject();
        row.put("field", name);
        int drifted = 0;
        drifted += level(row, "mAgree", estimated.mAgree(), packaged.mAgree());
        drifted += level(row, "uAgree", estimated.uAgree(), packaged.uAgree());
        drifted += level(row, "mDisagree", estimated.mDisagree(), packaged.mDisagree());
        drifted += level(row, "uDisagree", estimated.uDisagree(), packaged.uDisagree());
        drifted += level(row, "mMissing", estimated.mMissing(), packaged.mMissing());
        drifted += level(row, "uMissing", estimated.uMissing(), packaged.uMissing());
        return drifted;
    }

    private int thresholdRow(ArrayNode thresholds, String name, double estimated, double packaged) {
        var row = thresholds.addObject();
        row.put("threshold", name);
        return level(row, "value", estimated, packaged);
    }

    private int level(ObjectNode row, String key, double estimated, double packaged) {
        double delta = Math.abs(estimated - packaged);
        boolean drift = delta > EPSILON;
        var item = row.putObject(key);
        item.put("estimated", estimated);
        item.put("packaged", packaged);
        item.put("delta", Math.round(delta * 10000.0) / 10000.0);
        item.put("drift", drift);
        return drift ? 1 : 0;
    }
}
