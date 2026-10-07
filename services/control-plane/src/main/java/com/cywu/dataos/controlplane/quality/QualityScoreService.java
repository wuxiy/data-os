package com.cywu.dataos.controlplane.quality;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 质量评分聚合（G2G 批次 3，nema ReportGenerator 公式平移）：规则级得分由
 * runner 在执行时计算落库（score 三值），这里聚合每规则最近终态运行 →
 * 维度分（算术平均，无分项不计入）→ 总分（维度加权平均，无权重等权）→
 * 等级（grades.lowScore 降序首个达标）；passScore 逐规则判通过。
 *
 * <p>维度归属：动态规则按台账 rule_type 目录映射；静态 registry 规则按
 * evidence kind 推断（not_null/relationships→完整性，unique→完整性，
 * accepted_values→规范性）。无终态运行的规则不进入任何均值（nema 同口径）。
 */
@Service
public class QualityScoreService {

    private static final Set<String> DIMENSIONS = Set.of(
            "完整性", "一致性", "规范性", "准确性", "时效性", "稳定性");

    private static final Map<String, String> DIMENSION_BY_TYPE = Map.ofEntries(
            Map.entry("NOT_NULL", "完整性"), Map.entry("UNIQUE", "完整性"),
            Map.entry("FK_REF", "完整性"),
            Map.entry("VAL_SET", "规范性"), Map.entry("VAL_MINMAX", "规范性"),
            Map.entry("VAL_LEN", "规范性"), Map.entry("STR_REGEX", "规范性"),
            Map.entry("CROSS_VAL_COMPARE", "一致性"), Map.entry("STAT_VAL_COMPARE", "一致性"),
            Map.entry("SQL_STAT_VAL", "一致性"), Map.entry("DETAIL_STAT", "一致性"),
            Map.entry("SQL", "准确性"), Map.entry("FIELD_LOGIC", "准确性"),
            Map.entry("UPDATE_TIME", "时效性"), Map.entry("TIME_CONTINUITY", "稳定性"));

    private final JdbcTemplate jdbc;

    public QualityScoreService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- 评分标准（单行） ----

    public ScoreStandardView standard() {
        return jdbc.queryForObject("""
                SELECT pass_score, weights_json, grades_json, updated_at
                FROM data_os.quality_score_standard WHERE id = 1
                """, (rs, i) -> new ScoreStandardView(
                rs.getDouble("pass_score"),
                readWeights(rs.getString("weights_json")),
                readGrades(rs.getString("grades_json")),
                rs.getTimestamp("updated_at").toInstant()));
    }

    public ScoreStandardView updateStandard(Double passScore, Map<String, Integer> weights,
                                            List<Map<String, Object>> grades) {
        var next = new ScoreStandardView(
                passScore == null ? standard().passScore() : clampScore(passScore),
                weights == null || weights.isEmpty() ? standard().weights() : normalizeWeights(weights),
                grades == null || grades.isEmpty() ? standard().grades() : normalizeGrades(grades),
                java.time.Instant.now());
        jdbc.update("""
                UPDATE data_os.quality_score_standard
                SET pass_score = ?, weights_json = ?, grades_json = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
                """, next.passScore(), writeJson(next.weights()), writeJson(next.grades()));
        return standard();
    }

    // ---- 聚合 ----

    public ScoreSummary score() {
        var standard = standard();
        var rows = jdbc.query("""
                SELECT rule_id, dataset_id, score FROM (
                    SELECT rule_id, dataset_id, score,
                           ROW_NUMBER() OVER (PARTITION BY rule_id ORDER BY submitted_at DESC) AS rn
                    FROM data_os.quality_rule_runs
                    WHERE status IN ('SUCCEEDED', 'FAILED')
                ) ranked WHERE rn = 1
                """, (rs, i) -> Map.entry(rs.getString("rule_id"),
                new RuleScore(rs.getString("rule_id"), rs.getString("dataset_id"),
                        (Double) rs.getObject("score"), null, null, null)));

        // 规则 → 维度：动态台账优先，静态按 selector 缺省推断
        var ruleDimensions = new LinkedHashMap<String, String>();
        var typeByRule = new LinkedHashMap<String, String>();
        var columnByRule = new LinkedHashMap<String, String>();
        jdbc.query("SELECT rule_id, rule_type, target_column FROM data_os.quality_rule_definitions",
                        (rs, rowNumber) -> Map.entry(rs.getString("rule_id"),
                                new String[]{rs.getString("rule_type"), rs.getString("target_column")}))
                .forEach(entry -> {
                    typeByRule.put(entry.getKey(), entry.getValue()[0]);
                    columnByRule.put(entry.getKey(), entry.getValue()[1]);
                });
        var staticKindByRule = new LinkedHashMap<String, String>();
        try {
            // registry 表由 quality-runner 引导创建（生产共享库）；控制面独立
            // 测试库可能没有——查不到按无静态维度归属处理（退回完整性缺省）。
            jdbc.query("SELECT rule_id, evidence_json FROM data_os.quality_rule_registry",
                            (rs, rowNumber) -> Map.entry(rs.getString("rule_id"), rs.getString("evidence_json")))
                    .forEach(entry -> staticKindByRule.put(entry.getKey(), entry.getValue()));
        } catch (org.springframework.dao.DataAccessException ignored) {
            // 表不存在等访问异常：评分聚合不依赖静态注册表可完成
        }
        for (var rule : rows) {
            ruleDimensions.put(rule.getKey(), dimensionOf(rule.getKey(), typeByRule, staticKindByRule));
        }

        var rules = new ArrayList<RuleScore>();
        var byDimension = new LinkedHashMap<String, List<Double>>();
        for (var entry : rows) {
            var value = entry.getValue();
            if (value.score() == null) continue; // 无分不计入（nema 口径）
            var dimension = ruleDimensions.getOrDefault(value.ruleId(), "完整性");
            byDimension.computeIfAbsent(dimension, ignored -> new ArrayList<>()).add(value.score());
            // 台账无 name 字段：附带 ruleType / targetColumn 供前端人性化展示；
            // 静态 registry 规则不在动态台账中，两字段均为 null
            var targetColumn = columnByRule.get(value.ruleId());
            rules.add(new RuleScore(value.ruleId(), value.datasetId(), value.score(),
                    value.score() >= standard.passScore(),
                    typeByRule.get(value.ruleId()),
                    targetColumn == null || targetColumn.isBlank() ? null : targetColumn));
        }
        rules.sort(Comparator.comparing(RuleScore::ruleId));

        var dimensions = new ArrayList<DimensionScore>();
        for (var entry : byDimension.entrySet()) {
            var avg = entry.getValue().stream().mapToDouble(Double::doubleValue).average().orElse(0);
            dimensions.add(new DimensionScore(entry.getKey(), round(avg), entry.getValue().size()));
        }
        dimensions.sort(Comparator.comparing(DimensionScore::dimension));

        Double totalScore = null;
        if (!dimensions.isEmpty()) {
            double weightedSum = 0;
            int weightSum = 0;
            boolean anyWeight = false;
            for (var dimension : dimensions) {
                int weight = standard.weights().getOrDefault(dimension.dimension(), 1);
                weightedSum += dimension.score() * weight;
                weightSum += weight;
                anyWeight = anyWeight || weight != 1;
            }
            totalScore = round(anyWeight && weightSum > 0
                    ? weightedSum / weightSum
                    : dimensions.stream().mapToDouble(DimensionScore::score).average().orElse(0));
        }
        return new ScoreSummary(standard, dimensions, totalScore, gradeOf(totalScore, standard), rules);
    }

    private String dimensionOf(String ruleId, Map<String, String> typeByRule, Map<String, String> kindByRule) {
        var type = typeByRule.get(ruleId);
        if (type != null) return DIMENSION_BY_TYPE.getOrDefault(type, "完整性");
        var evidence = kindByRule.getOrDefault(ruleId, "");
        if (evidence.contains("\"kind\"")) {
            var lowered = evidence.toLowerCase(Locale.ROOT);
            if (lowered.contains("\"accepted_values\"")) return "规范性";
            if (lowered.contains("\"unique\"") || lowered.contains("\"relationships\"")) return "完整性";
        }
        return "完整性";
    }

    private String gradeOf(Double totalScore, ScoreStandardView standard) {
        if (totalScore == null) return null;
        return standard.grades().stream()
                .sorted(Comparator.comparingDouble(GradeView::lowScore).reversed())
                .filter(grade -> totalScore >= grade.lowScore())
                .map(GradeView::grade)
                .findFirst().orElse(null);
    }

    // ---- 序列化与校验 ----

    private Map<String, Integer> readWeights(String json) {
        try {
            var type = new com.fasterxml.jackson.core.type.TypeReference<LinkedHashMap<String, Integer>>() {
            };
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, type);
        } catch (Exception exception) {
            return Map.of();
        }
    }

    private List<GradeView> readGrades(String json) {
        try {
            var type = new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {
            };
            var raw = new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, type);
            var result = new ArrayList<GradeView>();
            for (var item : raw) {
                result.add(new GradeView(
                        String.valueOf(item.getOrDefault("grade", "")),
                        ((Number) item.getOrDefault("lowScore", 0)).doubleValue()));
            }
            return List.copyOf(result);
        } catch (Exception exception) {
            return List.of();
        }
    }

    private Map<String, Integer> normalizeWeights(Map<String, Integer> weights) {
        var normalized = new LinkedHashMap<String, Integer>();
        weights.forEach((dimension, weight) -> {
            if (DIMENSIONS.contains(dimension) && weight != null && weight >= 0 && weight <= 100) {
                normalized.put(dimension, weight);
            }
        });
        if (normalized.isEmpty()) throw new InvalidRequestException("维度权重至少要包含一个合法维度（0-100）");
        return normalized;
    }

    private List<GradeView> normalizeGrades(List<Map<String, Object>> grades) {
        var normalized = new ArrayList<GradeView>();
        for (var item : grades) {
            var grade = String.valueOf(item.getOrDefault("grade", "")).trim();
            Object low = item.get("lowScore");
            if (grade.isBlank() || !(low instanceof Number number)) {
                throw new InvalidRequestException("等级条目需要 grade 与 lowScore 数值");
            }
            normalized.add(new GradeView(grade, clampScore(number.doubleValue())));
        }
        if (normalized.isEmpty()) throw new InvalidRequestException("等级表不能为空");
        return List.copyOf(normalized);
    }

    private String writeJson(Object value) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalStateException("评分标准序列化失败", exception);
        }
    }

    private double clampScore(double score) {
        return Math.max(0, Math.min(100, score));
    }

    private double round(double value) {
        return Math.round(value * 100.0) / 100.0;
    }

    // ---- 视图 ----

    public record GradeView(String grade, double lowScore) {
    }

    public record ScoreStandardView(double passScore, Map<String, Integer> weights,
                                    List<GradeView> grades, java.time.Instant updatedAt) {
    }

    /** ruleType / targetColumn 来自动态台账（V24）；静态 registry 规则无台账记录时为 null。 */
    public record RuleScore(String ruleId, String datasetId, Double score, Boolean passed,
                            String ruleType, String targetColumn) {
    }

    public record DimensionScore(String dimension, double score, int ruleCount) {
    }

    public record ScoreSummary(ScoreStandardView standard, List<DimensionScore> dimensions,
                               Double totalScore, String grade, List<RuleScore> rules) {
    }
}
