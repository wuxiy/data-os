package com.cywu.dataos.mpi.matcher;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.ToDoubleFunction;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 评测语料装载（G14 冻结语料与 T5b 漂移检测共用）：JSONL → Pair/Anchor/
 * 姓名频率。语料行格式见 eval/generate_corpus.py；缺失以 JSON null 承载。
 */
final class MpiCorpus {

    record Pair(String id, boolean match, String kind, boolean blockingReachable,
                MatchPair.Side a, MatchPair.Side b) {

        /** 语料行 → 统一引擎输入（各引擎共用的唯一适配）。 */
        MatchPair toMatchPair() {
            return new MatchPair(a, b);
        }
    }

    record Anchor(String id, boolean match, Pair pair) {
    }

    private final ObjectMapper json = new ObjectMapper();

    List<Pair> load(Path path) throws IOException {
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
        org.assertj.core.api.Assertions.assertThat(pairs).isNotEmpty();
        return pairs;
    }

    List<Anchor> anchors(Path dir) throws IOException {
        var anchors = new ArrayList<Anchor>();
        for (String line : Files.readAllLines(dir.resolve("anchors.jsonl"))) {
            var node = json.readTree(line);
            boolean same = "SAME_PERSON".equals(node.get("resolution").asText());
            String id = "anchor-" + node.get("pairId").asText();
            anchors.add(new Anchor(id, same,
                    new Pair(id, same, "human-anchor", false,
                            side(node.get("a")), side(node.get("b")))));
        }
        return anchors;
    }

    /** 姓名频率 u 细化：快照内计数；未见姓名退回平均频率。 */
    ToDoubleFunction<String> nameFrequency(Path snapshot) throws IOException {
        Map<String, Integer> counts = new HashMap<>();
        int total = 0;
        for (String line : Files.readAllLines(snapshot)) {
            var node = json.readTree(line);
            counts.merge(node.get("name").asText(), 1, Integer::sum);
            total++;
        }
        org.assertj.core.api.Assertions.assertThat(total).isGreaterThan(0);
        final int denominator = total;
        Map<String, Double> frozen = new HashMap<>();
        counts.forEach((name, count) -> frozen.put(name, (double) count / denominator));
        return name -> frozen.getOrDefault(name, frozen.values().stream()
                .mapToDouble(Double::doubleValue).average().orElse(0.4));
    }

    private MatchPair.Side side(JsonNode node) {
        return new MatchPair.Side(node.get("institution").asText(null), node.get("patientId").asText(null),
                nullsToNull(node.get("card")), node.get("name").asText(null),
                nullsToNull(node.get("gender")), nullsToNull(node.get("contactHash")));
    }

    /** JSON null → Java null（缺失语义在比较级里承载）。 */
    private static String nullsToNull(JsonNode node) {
        return node == null || node.isNull() ? null : node.asText();
    }
}
