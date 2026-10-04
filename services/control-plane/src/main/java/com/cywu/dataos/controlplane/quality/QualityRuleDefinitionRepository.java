package com.cywu.dataos.controlplane.quality;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** 动态质量规则定义台账（V24）。 */
@Repository
public class QualityRuleDefinitionRepository {

    private static final TypeReference<Map<String, Object>> PARAMS_TYPE = new TypeReference<>() {
    };
    private static final TypeReference<List<Map<String, String>>> EVIDENCE_TYPE = new TypeReference<>() {
    };

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public QualityRuleDefinitionRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public List<QualityRuleDefinition> findAll(String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT rule_id, rule_type, dataset_id, target_column, params_json, evidence_json,
                       enabled, created_at, updated_at
                FROM data_os.quality_rule_definitions
                WHERE tenant_id = ? AND institution_id = ?
                ORDER BY created_at DESC
                """, (rs, i) -> new QualityRuleDefinition(
                rs.getString("rule_id"), tenantId, institutionId,
                rs.getString("rule_type"), rs.getString("dataset_id"), rs.getString("target_column"),
                read(rs.getString("params_json"), PARAMS_TYPE, Map.of()),
                read(rs.getString("evidence_json"), EVIDENCE_TYPE, List.of()),
                Boolean.TRUE.equals(rs.getObject("enabled")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()), tenantId, institutionId);
    }

    public Optional<QualityRuleDefinition> findById(String ruleId, String tenantId, String institutionId) {
        return jdbc.query("""
                SELECT rule_id, rule_type, dataset_id, target_column, params_json, evidence_json,
                       enabled, created_at, updated_at
                FROM data_os.quality_rule_definitions
                WHERE rule_id = ? AND tenant_id = ? AND institution_id = ?
                """, (rs, i) -> new QualityRuleDefinition(
                rs.getString("rule_id"), tenantId, institutionId,
                rs.getString("rule_type"), rs.getString("dataset_id"), rs.getString("target_column"),
                read(rs.getString("params_json"), PARAMS_TYPE, Map.of()),
                read(rs.getString("evidence_json"), EVIDENCE_TYPE, List.of()),
                Boolean.TRUE.equals(rs.getObject("enabled")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant()), ruleId, tenantId, institutionId)
                .stream().findFirst();
    }

    public boolean exists(String ruleId) {
        var result = jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM data_os.quality_rule_definitions WHERE rule_id = ?)",
                Boolean.class, ruleId);
        return Boolean.TRUE.equals(result);
    }

    public void save(QualityRuleDefinition definition) {
        jdbc.update("""
                DELETE FROM data_os.quality_rule_definitions WHERE rule_id = ?
                """, definition.ruleId());
        jdbc.update("""
                INSERT INTO data_os.quality_rule_definitions
                    (rule_id, tenant_id, institution_id, rule_type, dataset_id, target_column,
                     params_json, evidence_json, enabled, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, definition.ruleId(), definition.tenantId(), definition.institutionId(),
                definition.ruleType(), definition.datasetId(), definition.targetColumn(),
                write(definition.params()), write(definition.evidenceColumns()),
                definition.enabled(), Timestamp.from(definition.createdAt()), Timestamp.from(definition.updatedAt()));
    }

    public int setEnabled(String ruleId, String tenantId, String institutionId, boolean enabled) {
        return jdbc.update("""
                UPDATE data_os.quality_rule_definitions
                SET enabled = ?, updated_at = CURRENT_TIMESTAMP
                WHERE rule_id = ? AND tenant_id = ? AND institution_id = ?
                """, enabled, ruleId, tenantId, institutionId);
    }

    public int delete(String ruleId, String tenantId, String institutionId) {
        return jdbc.update("""
                DELETE FROM data_os.quality_rule_definitions
                WHERE rule_id = ? AND tenant_id = ? AND institution_id = ?
                """, ruleId, tenantId, institutionId);
    }

    private <T> T read(String json, TypeReference<T> type, T fallback) {
        if (json == null || json.isBlank()) return fallback;
        try {
            return objectMapper.readValue(json, type);
        } catch (Exception exception) {
            return fallback;
        }
    }

    private String write(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalStateException("质量规则定义无法序列化", exception);
        }
    }
}
