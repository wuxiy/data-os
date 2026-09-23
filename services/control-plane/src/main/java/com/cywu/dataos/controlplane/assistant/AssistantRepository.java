package com.cywu.dataos.controlplane.assistant;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 问数仓储（G26）：查询一律 tenant 过滤；审计写入为追加式，反馈为条件回写。
 */
@Repository
public class AssistantRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public AssistantRepository(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    // ---- 已验证问题 ----

    public List<AssistantQuestion> findPublished(String tenantId) {
        return jdbc.query("""
                SELECT * FROM data_os.assistant_verified_question
                WHERE tenant_id = ? AND status = 'PUBLISHED' ORDER BY code
                """, this::mapQuestion, tenantId);
    }

    /** 插入问题（Beta 期种子路径：迁移播种 + 测试播种；管理端点不在 G26 范围）。 */
    public void insertQuestion(AssistantQuestion question) {
        jdbc.update("""
                INSERT INTO data_os.assistant_verified_question
                    (id, tenant_id, code, question, aliases_json, param_schema_json,
                     service_code, answer_template, status, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, question.id(), question.tenantId(), question.code(), question.question(),
                writeAliases(question.aliases()), question.paramSchemaJson(),
                question.serviceCode(), question.answerTemplate(), question.status(),
                question.createdBy(), Timestamp.from(question.createdAt()),
                Timestamp.from(question.updatedAt()));
    }

    private String writeAliases(List<String> aliases) {
        try {
            return objectMapper.writeValueAsString(aliases == null ? List.of() : aliases);
        } catch (Exception exception) {
            return "[]";
        }
    }

    public Optional<AssistantQuestion> find(String tenantId, String id) {
        return jdbc.query("""
                SELECT * FROM data_os.assistant_verified_question
                WHERE tenant_id = ? AND id = ?
                """, this::mapQuestion, tenantId, id).stream().findFirst();
    }

    private AssistantQuestion mapQuestion(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new AssistantQuestion(
                rs.getString("id"), rs.getString("tenant_id"), rs.getString("code"),
                rs.getString("question"), parseAliases(rs.getString("aliases_json")),
                rs.getString("param_schema_json"), rs.getString("service_code"),
                rs.getString("answer_template"), rs.getString("status"),
                rs.getString("created_by"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private List<String> parseAliases(String aliasesJson) {
        try {
            return objectMapper.readValue(aliasesJson == null || aliasesJson.isBlank()
                    ? "[]" : aliasesJson,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (Exception exception) {
            return List.of();
        }
    }

    // ---- 问数审计 ----

    public void insertAudit(AssistantQueryAudit audit) {
        jdbc.update("""
                INSERT INTO data_os.assistant_query_audit
                    (id, tenant_id, institution_id, user_id, question_text, question_code,
                     service_code, service_version, params_json, row_count, elapsed_ms,
                     outcome, detail, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, audit.id(), audit.tenantId(), audit.institutionId(), audit.userId(),
                audit.questionText(), audit.questionCode(), audit.serviceCode(),
                audit.serviceVersion(), audit.paramsJson(), audit.rowCount(),
                audit.elapsedMs(), audit.outcome(), audit.detail(),
                Timestamp.from(audit.createdAt()));
    }

    public Optional<AssistantQueryAudit> findAudit(String tenantId, String id) {
        return jdbc.query("""
                SELECT * FROM data_os.assistant_query_audit
                WHERE tenant_id = ? AND id = ?
                """, this::mapAudit, tenantId, id).stream().findFirst();
    }

    /** 反馈回写（幂等：重复反馈覆盖前值）。 */
    public int updateFeedback(String tenantId, String id, String rating, String note) {
        return jdbc.update("""
                UPDATE data_os.assistant_query_audit
                SET feedback_rating = ?, feedback_note = ?, feedback_at = ?
                WHERE tenant_id = ? AND id = ?
                """, rating, note, Timestamp.from(Instant.now()), tenantId, id);
    }

    public List<AssistantQueryAudit> findAudits(String tenantId, int limit) {
        return jdbc.query("""
                SELECT * FROM data_os.assistant_query_audit
                WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?
                """, this::mapAudit, tenantId, limit);
    }

    private AssistantQueryAudit mapAudit(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        var feedbackAt = rs.getTimestamp("feedback_at");
        return new AssistantQueryAudit(
                rs.getString("id"), rs.getString("tenant_id"), rs.getString("institution_id"),
                rs.getString("user_id"), rs.getString("question_text"), rs.getString("question_code"),
                rs.getString("service_code"), rs.getString("service_version"),
                rs.getString("params_json"), rs.getInt("row_count"), rs.getInt("elapsed_ms"),
                rs.getString("outcome"), rs.getString("detail"), rs.getString("feedback_rating"),
                rs.getString("feedback_note"), feedbackAt == null ? null : feedbackAt.toInstant(),
                rs.getTimestamp("created_at").toInstant());
    }

    public static String newId() {
        return UUID.randomUUID().toString();
    }
}
