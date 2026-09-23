package com.cywu.dataos.controlplane.assistant;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 受控智能问数编排（G26）：只做问题匹配（代码/问题/别名的确定性归一匹配，
 * 分类器接缝保留在 {@link #match}）、参数校验（问题 Schema，与执行面二次校验
 * 双保险）、用户范围与回答编排。查询执行独占 Data API，本层不产生 SQL。
 * 所有提问（含拒答）落一行问数审计；拒答统一信封 answered=false + outcome。
 */
@Service
public class AssistantAdminService {

    public static final Pattern DATE_PATTERN = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");

    private final AssistantRepository repository;
    private final AssistantDataApiClient dataApi;
    private final TenantScope tenantScope;
    private final ObjectMapper objectMapper;

    public AssistantAdminService(AssistantRepository repository, AssistantDataApiClient dataApi,
                                 TenantScope tenantScope, ObjectMapper objectMapper) {
        this.repository = repository;
        this.dataApi = dataApi;
        this.tenantScope = tenantScope;
        this.objectMapper = objectMapper;
    }

    // ---- 问题清单 ----

    public Map<String, Object> questions(String tenantId) {
        var questions = repository.findPublished(tenantScope.resolve(tenantId, null).tenantId());
        return Map.of("total", questions.size(), "questions", questions.stream()
                .map(this::questionView).toList());
    }

    private Map<String, Object> questionView(AssistantQuestion question) {
        var view = new LinkedHashMap<String, Object>();
        view.put("code", question.code());
        view.put("question", question.question());
        view.put("aliases", question.aliases());
        view.put("paramSchema", parseSchema(question.paramSchemaJson()));
        view.put("serviceCode", question.serviceCode());
        return view;
    }

    // ---- 提问 ----

    public Map<String, Object> query(String tenantId, String text, Map<String, Object> parameters) {
        var scope = tenantScope.resolve(tenantId, null);
        var questionText = text == null ? "" : text.strip();
        var params = parameters == null ? Map.<String, Object>of() : parameters;

        var questions = repository.findPublished(scope.tenantId());
        var matched = match(questions, questionText);
        if (matched == null) {
            return refused(scope, questionText, "REFUSED_NO_MATCH",
                    "没有可回答的已验证问题；请从支持的问题清单中选择表达。", questions);
        }
        return execute(scope, questionText, matched, params, questions, false);
    }

    /** 匹配后的执行编排（提问与试运行共享）：校验→执行→渲染→审计。 */
    private Map<String, Object> execute(TenantScope.Scope scope, String questionText,
                                        AssistantQuestion matched, Map<String, Object> params,
                                        List<AssistantQuestion> questions, boolean testRun) {
        var validation = validateParams(matched, params);
        if (!validation.errors().isEmpty()) {
            return refused(scope, questionText, "REFUSED_PARAM_INVALID",
                    "参数不满足问题 Schema: " + String.join("; ", validation.errors()), questions,
                    matched, validation.normalized(), testRun);
        }
        if (!dataApi.configured()) {
            return refused(scope, questionText, "REFUSED_UNAVAILABLE",
                    "问数执行面未配置或服务身份不可用（data-os.assistant.*）", questions,
                    matched, validation.normalized(), testRun);
        }

        AssistantDataApiClient.QueryResult result;
        try {
            result = dataApi.query(matched.serviceCode(), validation.normalized());
        } catch (AssistantDataApiClient.QueryRejected rejected) {
            var outcome = switch (rejected.kind) {
                case "SERVICE_OFFLINE" -> "REFUSED_SERVICE_OFFLINE";
                case "RATE_LIMITED" -> "REFUSED_RATE_LIMITED";
                case "PARAM_REJECTED" -> "REFUSED_PARAM_INVALID";
                default -> "REFUSED_UNAVAILABLE";
            };
            return refused(scope, questionText, outcome, rejected.getMessage(), questions,
                    matched, validation.normalized(), testRun);
        } catch (AdapterUnavailableException exception) {
            return refused(scope, questionText, "REFUSED_UNAVAILABLE", exception.getMessage(),
                    questions, matched, validation.normalized(), testRun);
        }

        var auditId = writeAudit(scope, questionText, matched, validation.normalized(),
                "ANSWERED", testRun ? "test-run" : "", result.rowCount(), result.elapsedMs(),
                result.serviceVersion());
        var answer = new LinkedHashMap<String, Object>();
        answer.put("answered", true);
        answer.put("auditId", auditId);
        answer.put("question", questionView(matched));
        answer.put("answer", renderTemplate(matched.answerTemplate(), validation.normalized(),
                result));
        answer.put("columns", result.columns());
        answer.put("rows", result.rows());
        answer.put("rowCount", result.rowCount());
        answer.put("truncated", result.truncated());
        answer.put("evidence", evidence(matched, result, validation.normalized()));
        if (testRun) {
            answer.put("testRun", true);
        }
        return answer;
    }

    /** 拒答信封（审计留痕 + 支持问题提示，绝不回退演示答案）。 */
    private Map<String, Object> refused(TenantScope.Scope scope, String questionText,
                                        String outcome, String reason,
                                        List<AssistantQuestion> questions) {
        return refused(scope, questionText, outcome, reason, questions, null, Map.of(), false);
    }

    private Map<String, Object> refused(TenantScope.Scope scope, String questionText,
                                        String outcome, String reason,
                                        List<AssistantQuestion> questions,
                                        AssistantQuestion matched, Map<String, Object> params,
                                        boolean testRun) {
        var auditId = writeAudit(scope, questionText, matched, params, outcome,
                (testRun ? "test-run: " : "") + reason, 0, 0, "");
        var answer = new LinkedHashMap<String, Object>();
        answer.put("answered", false);
        answer.put("auditId", auditId);
        answer.put("outcome", outcome);
        answer.put("reason", reason);
        answer.put("supportedQuestions", questions.stream().map(AssistantQuestion::question).toList());
        if (testRun) {
            answer.put("testRun", true);
        }
        return answer;
    }

    private Map<String, Object> evidence(AssistantQuestion question,
                                         AssistantDataApiClient.QueryResult result,
                                         Map<String, Object> params) {
        var view = new LinkedHashMap<String, Object>();
        view.put("serviceCode", question.serviceCode());
        view.put("serviceVersion", result.serviceVersion());
        view.put("statisticsWindow", params);
        view.put("rowCount", result.rowCount());
        view.put("truncated", result.truncated());
        view.put("elapsedMs", result.elapsedMs());
        view.put("executedAt", Instant.now().toString());
        view.put("executionPath", "verified-question -> data-api verified-queries");
        return view;
    }

    // ---- 反馈（可追溯到具体审计行）----

    public Map<String, Object> feedback(String tenantId, String auditId, String rating, String note) {
        var resolvedTenant = tenantScope.resolve(tenantId, null).tenantId();
        repository.findAudit(resolvedTenant, auditId)
                .orElseThrow(() -> new ResourceNotFoundException("问数审计记录不存在：" + auditId));
        if (!"helpful".equals(rating) && !"not_helpful".equals(rating)) {
            throw new InvalidRequestException("rating 仅允许 helpful / not_helpful");
        }
        repository.updateFeedback(resolvedTenant, auditId, rating, note == null ? "" : note.trim());
        return Map.of("auditId", auditId, "rating", rating, "recorded", true);
    }

    // ---- 治理面（G27：问题生命周期管理）----

    public static final Pattern CODE_PATTERN = Pattern.compile("^[a-z0-9][a-z0-9-]{2,63}$");
    private static final Pattern PARAM_NAME_PATTERN = Pattern.compile("^[a-z_][a-z0-9_]{0,63}$");
    private static final Set<String> PARAM_TYPES = Set.of("string", "date", "number", "boolean");

    /** 治理列表（全状态，含发布门证据：最近成功试运行是否晚于最后编辑）。 */
    public Map<String, Object> adminQuestions(String tenantId) {
        var scope = tenantScope.resolve(tenantId, null);
        var questions = repository.findAllQuestions(scope.tenantId());
        return Map.of("total", questions.size(), "questions", questions.stream()
                .map(this::adminQuestionView).toList());
    }

    private Map<String, Object> adminQuestionView(AssistantQuestion question) {
        var view = new LinkedHashMap<String, Object>();
        view.put("code", question.code());
        view.put("question", question.question());
        view.put("aliases", question.aliases());
        view.put("paramSchema", parseSchema(question.paramSchemaJson()));
        view.put("serviceCode", question.serviceCode());
        view.put("answerTemplate", question.answerTemplate());
        view.put("status", question.status());
        view.put("createdBy", question.createdBy());
        view.put("createdAt", question.createdAt().toString());
        view.put("updatedAt", question.updatedAt().toString());
        var lastPassed = repository.findLatestPassedTestRun(question.tenantId(), question.code());
        view.put("lastPassedTestRun", lastPassed.map(Instant::toString).orElse(null));
        view.put("verified", lastPassed.isPresent()
                && lastPassed.get().isAfter(question.updatedAt()));
        return view;
    }

    public Map<String, Object> createQuestion(String tenantId, QuestionDraft draft) {
        var scope = tenantScope.resolve(tenantId, null);
        validateDraft(draft);
        if (repository.findQuestionByCode(scope.tenantId(), draft.code()).isPresent()) {
            throw new ConflictException("问题代码已存在: " + draft.code());
        }
        var now = Instant.now();
        var question = new AssistantQuestion(AssistantRepository.newId(), scope.tenantId(),
                draft.code(), draft.question().strip(), dedupeAliases(draft.aliases()),
                writeSchema(draft.paramSchema()), draft.serviceCode().strip(),
                draft.answerTemplate() == null ? "" : draft.answerTemplate().strip(),
                "DRAFT", scope.subject(), now, now);
        repository.insertQuestion(question);
        recordEvent(scope, question, "CREATED", "{}");
        return Map.of("code", question.code(), "status", question.status());
    }

    public Map<String, Object> updateQuestion(String tenantId, String code, QuestionDraft draft) {
        var scope = tenantScope.resolve(tenantId, null);
        var question = requireQuestion(scope.tenantId(), code);
        requireStatus(question, "DRAFT", "仅草稿可编辑（已发布/已停用问题不可改）");
        validateDraft(draft, code);
        var updated = new AssistantQuestion(question.id(), question.tenantId(), question.code(),
                draft.question().strip(), dedupeAliases(draft.aliases()),
                writeSchema(draft.paramSchema()), draft.serviceCode().strip(),
                draft.answerTemplate() == null ? "" : draft.answerTemplate().strip(),
                question.status(), question.createdBy(), question.createdAt(), Instant.now());
        if (repository.updateQuestion(updated) == 0) {
            throw new ConflictException("仅草稿可编辑（并发状态已变化）");
        }
        recordEvent(scope, updated, "UPDATED", "{}");
        return Map.of("code", code, "status", updated.status());
    }

    /** 发布门：最近一次成功试运行必须晚于最后编辑（配置验证过才可上线）。 */
    public Map<String, Object> publishQuestion(String tenantId, String code) {
        var scope = tenantScope.resolve(tenantId, null);
        var question = requireQuestion(scope.tenantId(), code);
        requireStatus(question, "DRAFT", "仅草稿可发布");
        var lastPassed = repository.findLatestPassedTestRun(scope.tenantId(), code);
        if (lastPassed.isEmpty()) {
            throw new ConflictException("发布需先试运行成功（该问题尚无成功试运行记录）");
        }
        if (!lastPassed.get().isAfter(question.updatedAt())) {
            throw new ConflictException("发布需最近一次成功试运行晚于最后一次编辑（当前配置未验证，请重新试运行）");
        }
        if (repository.casStatus(scope.tenantId(), question.id(), "DRAFT", "PUBLISHED") == 0) {
            throw new ConflictException("仅草稿可发布（并发状态已变化）");
        }
        recordEvent(scope, question, "PUBLISHED",
                "{\"testedAt\":\"" + lastPassed.get() + "\"}");
        return Map.of("code", code, "status", "PUBLISHED");
    }

    public Map<String, Object> deprecateQuestion(String tenantId, String code) {
        var scope = tenantScope.resolve(tenantId, null);
        var question = requireQuestion(scope.tenantId(), code);
        requireStatus(question, "PUBLISHED", "仅已发布问题可停用");
        if (repository.casStatus(scope.tenantId(), question.id(), "PUBLISHED", "DEPRECATED") == 0) {
            throw new ConflictException("仅已发布问题可停用（并发状态已变化）");
        }
        recordEvent(scope, question, "DEPRECATED", "{}");
        return Map.of("code", code, "status", "DEPRECATED");
    }

    /** 重新起草：DEPRECATED→DRAFT（服务恢复后重新验证上线；走正常 编辑→试运行→发布 门）。 */
    public Map<String, Object> reopenQuestion(String tenantId, String code) {
        var scope = tenantScope.resolve(tenantId, null);
        var question = requireQuestion(scope.tenantId(), code);
        requireStatus(question, "DEPRECATED", "仅已停用问题可重新起草");
        if (repository.casStatus(scope.tenantId(), question.id(), "DEPRECATED", "DRAFT") == 0) {
            throw new ConflictException("仅已停用问题可重新起草（并发状态已变化）");
        }
        recordEvent(scope, question, "UPDATED", "{\"reopened\":true}");
        return Map.of("code", code, "status", "DRAFT");
    }

    public Map<String, Object> deleteQuestion(String tenantId, String code) {
        var scope = tenantScope.resolve(tenantId, null);
        var question = requireQuestion(scope.tenantId(), code);
        requireStatus(question, "DRAFT", "仅草稿可删除（已发布问题请停用留痕）");
        if (repository.deleteQuestion(scope.tenantId(), question.id()) == 0) {
            throw new ConflictException("仅草稿可删除（并发状态已变化）");
        }
        recordEvent(scope, question, "DELETED", "{}");
        return Map.of("code", code, "deleted", true);
    }

    /** 试运行：DRAFT/PUBLISHED 均可（发布前验证配置；审计 detail 以 test-run 前缀区分）。 */
    public Map<String, Object> testQuestion(String tenantId, String code, Map<String, Object> params) {
        var scope = tenantScope.resolve(tenantId, null);
        var question = requireQuestion(scope.tenantId(), code);
        if ("DEPRECATED".equals(question.status())) {
            throw new ConflictException("已停用问题不可试运行（请先重新起草）");
        }
        var published = repository.findPublished(scope.tenantId());
        return execute(scope, question.code(), question,
                params == null ? Map.of() : params, published, true);
    }

    /** 问题生命周期事件（治理动作留痕，倒序；删除后按 code 仍可查——留痕可追溯）。 */
    public Map<String, Object> questionEvents(String tenantId, String code, int limit) {
        var scope = tenantScope.resolve(tenantId, null);
        var events = repository.findQuestionEvents(scope.tenantId(), code, limit);
        var total = repository.countQuestionEvents(scope.tenantId(), code);
        if (events.isEmpty() && repository.findQuestionByCode(scope.tenantId(), code).isEmpty()) {
            throw new ResourceNotFoundException("已验证问题不存在: " + code);
        }
        return Map.of("code", code,
                "total", total,
                "returned", events.size(),
                "events", events.stream()
                        .map(event -> Map.of(
                                "action", event.action(),
                                "actor", event.actor(),
                                "detail", event.detailJson(),
                                "createdAt", event.createdAt().toString()))
                        .toList());
    }

    // ---- 审计管理面（G27 余项）：只读 + CSV 导出，反馈随行呈现 ----

    public Map<String, Object> audits(String tenantId, String outcome, int page, int pageSize) {
        var scope = tenantScope.resolve(tenantId, null);
        var safeOutcome = outcome == null ? "" : outcome.strip();
        var safePageSize = Math.min(Math.max(pageSize, 1), 100);
        var safePage = Math.max(page, 0);
        var audits = repository.findAudits(scope.tenantId(), safeOutcome,
                safePage * safePageSize, safePageSize);
        return Map.of(
                "total", repository.countAudits(scope.tenantId(), safeOutcome),
                "page", safePage,
                "pageSize", safePageSize,
                "audits", audits.stream().map(this::auditView).toList());
    }

    /** CSV 导出（同租户同过滤口径；上限 10000 行防失控导出）。 */
    public String auditCsv(String tenantId, String outcome) {
        var scope = tenantScope.resolve(tenantId, null);
        var safeOutcome = outcome == null ? "" : outcome.strip();
        var audits = repository.findAudits(scope.tenantId(), safeOutcome, 0, 10_000);
        var builder = new StringBuilder();
        builder.append("audit_id,created_at,user_id,institution_id,question_text,question_code,")
                .append("service_code,outcome,row_count,elapsed_ms,detail,feedback_rating,feedback_note\n");
        for (AssistantQueryAudit audit : audits) {
            builder.append(csv(audit.id())).append(',')
                    .append(csv(audit.createdAt().toString())).append(',')
                    .append(csv(audit.userId())).append(',')
                    .append(csv(audit.institutionId())).append(',')
                    .append(csv(audit.questionText())).append(',')
                    .append(csv(audit.questionCode())).append(',')
                    .append(csv(audit.serviceCode())).append(',')
                    .append(csv(audit.outcome())).append(',')
                    .append(audit.rowCount()).append(',')
                    .append(audit.elapsedMs()).append(',')
                    .append(csv(audit.detail())).append(',')
                    .append(csv(audit.feedbackRating() == null ? "" : audit.feedbackRating())).append(',')
                    .append(csv(audit.feedbackNote() == null ? "" : audit.feedbackNote()))
                    .append('\n');
        }
        return builder.toString();
    }

    private Map<String, Object> auditView(AssistantQueryAudit audit) {
        var view = new LinkedHashMap<String, Object>();
        view.put("id", audit.id());
        view.put("createdAt", audit.createdAt().toString());
        view.put("userId", audit.userId());
        view.put("institutionId", audit.institutionId());
        view.put("questionText", audit.questionText());
        view.put("questionCode", audit.questionCode());
        view.put("serviceCode", audit.serviceCode());
        view.put("outcome", audit.outcome());
        view.put("rowCount", audit.rowCount());
        view.put("elapsedMs", audit.elapsedMs());
        view.put("detail", audit.detail());
        view.put("feedbackRating", audit.feedbackRating());
        view.put("feedbackNote", audit.feedbackNote());
        return view;
    }

    /** RFC 4180 转义：含逗号/引号/换行即整体加引号并双写引号。 */
    private static String csv(String value) {
        var text = value == null ? "" : value;
        if (text.contains(",") || text.contains("\"") || text.contains("\n") || text.contains("\r")) {
            return '"' + text.replace("\"", "\"\"") + '"';
        }
        return text;
    }

    private AssistantQuestion requireQuestion(String tenantId, String code) {
        return repository.findQuestionByCode(tenantId, code)
                .orElseThrow(() -> new ResourceNotFoundException("已验证问题不存在: " + code));
    }

    private void requireStatus(AssistantQuestion question, String expected, String message) {
        if (!expected.equals(question.status())) {
            throw new ConflictException(message + "，当前状态: " + question.status());
        }
    }

    private void recordEvent(TenantScope.Scope scope, AssistantQuestion question,
                             String action, String detailJson) {
        repository.insertQuestionEvent(new AssistantQuestionEvent(
                AssistantRepository.newId(), scope.tenantId(), question.id(), question.code(),
                action, scope.subject(), detailJson, Instant.now()));
    }

    private void validateDraft(QuestionDraft draft) {
        validateDraft(draft, draft.code());
    }

    private void validateDraft(QuestionDraft draft, String existingCode) {
        if (draft.code() == null || !CODE_PATTERN.matcher(draft.code()).matches()) {
            throw new InvalidRequestException(
                    "code 须为 3-64 位小写字母/数字/连字符，且以字母或数字开头: " + draft.code());
        }
        if (!draft.code().equals(existingCode)) {
            throw new InvalidRequestException("问题代码不可修改（当前: " + existingCode + "）");
        }
        if (draft.question() == null || draft.question().isBlank()
                || draft.question().length() > 256) {
            throw new InvalidRequestException("question 必填且不超过 256 字符");
        }
        if (draft.serviceCode() == null || !CODE_PATTERN.matcher(draft.serviceCode()).matches()) {
            throw new InvalidRequestException("serviceCode 须为 3-64 位小写字母/数字/连字符: "
                    + draft.serviceCode());
        }
        if (draft.answerTemplate() != null && draft.answerTemplate().length() > 512) {
            throw new InvalidRequestException("answerTemplate 不超过 512 字符");
        }
        validateSchemaShape(draft.paramSchema());
    }

    /** 参数 Schema 形状校验（与执行面类型集一致：string/date/number/boolean）。 */
    private void validateSchemaShape(java.util.List<Map<String, Object>> schema) {
        if (schema == null) {
            return;
        }
        if (schema.size() > 16) {
            throw new InvalidRequestException("paramSchema 参数不超过 16 个");
        }
        var names = new java.util.HashSet<String>();
        for (var item : schema) {
            var name = String.valueOf(item.getOrDefault("name", "")).strip();
            if (!PARAM_NAME_PATTERN.matcher(name).matches()) {
                throw new InvalidRequestException("paramSchema.name 须为 1-64 位小写字母/数字/下划线: "
                        + name);
            }
            if (!names.add(name)) {
                throw new InvalidRequestException("paramSchema.name 重复: " + name);
            }
            var type = String.valueOf(item.getOrDefault("type", "string")).strip();
            if (!PARAM_TYPES.contains(type)) {
                throw new InvalidRequestException("paramSchema.type 仅允许 "
                        + String.join("/", PARAM_TYPES) + ": " + type);
            }
            if (item.containsKey("required")
                    && !(item.get("required") instanceof Boolean)) {
                throw new InvalidRequestException("paramSchema.required 须为布尔: " + name);
            }
            if (item.get("values") instanceof java.util.List<?> values) {
                if (values.isEmpty()) {
                    throw new InvalidRequestException("paramSchema.values 须非空: " + name);
                }
            } else if (item.containsKey("values")) {
                throw new InvalidRequestException("paramSchema.values 须为字符串数组: " + name);
            }
        }
    }

    private List<String> dedupeAliases(List<String> aliases) {
        if (aliases == null || aliases.isEmpty()) {
            return List.of();
        }
        var seen = new java.util.LinkedHashSet<String>();
        for (String alias : aliases) {
            var text = alias == null ? "" : alias.strip();
            if (!text.isEmpty()) {
                seen.add(text);
            }
        }
        return List.copyOf(seen);
    }

    private String writeSchema(java.util.List<Map<String, Object>> schema) {
        if (schema == null || schema.isEmpty()) {
            return "[]";
        }
        try {
            return objectMapper.writeValueAsString(schema);
        } catch (Exception exception) {
            throw new InvalidRequestException("paramSchema 序列化失败");
        }
    }

    /** 治理面问题草稿（新建/编辑共用；code 唯一且不可改）。 */
    public record QuestionDraft(
            String code,
            String question,
            List<String> aliases,
            java.util.List<Map<String, Object>> paramSchema,
            String serviceCode,
            String answerTemplate) {
    }


    // ---- 匹配与校验 ----

    /**
     * 确定性匹配（分类器接缝）：归一化后与代码 / 问题文本 / 别名全等比较。
     * 归一 = 去首尾空白、全角问号归一、压缩连续空白、小写。
     */
    static AssistantQuestion match(List<AssistantQuestion> questions, String text) {
        var normalized = normalize(text);
        if (normalized.isBlank()) {
            return null;
        }
        for (AssistantQuestion question : questions) {
            if (question.code().equalsIgnoreCase(text)) {
                return question;
            }
            if (normalized.equals(normalize(question.question()))) {
                return question;
            }
            for (String alias : question.aliases()) {
                if (normalized.equals(normalize(alias))) {
                    return question;
                }
            }
        }
        return null;
    }

    static String normalize(String text) {
        if (text == null) {
            return "";
        }
        return text.strip()
                .replace('？', '?')
                .replace("?", "")
                .replaceAll("\\s+", " ")
                .toLowerCase();
    }

    /** 问题参数 Schema 校验（与执行面同规则：date/number/boolean/枚举/必填/默认值）。 */
    private record ParamValidation(Map<String, Object> normalized, List<String> errors) {
    }

    private ParamValidation validateParams(AssistantQuestion question, Map<String, Object> payload) {
        var contracts = parseSchema(question.paramSchemaJson());
        var normalized = new LinkedHashMap<String, Object>();
        var errors = new ArrayList<String>();
        var known = new LinkedHashMap<String, JsonNode>();
        for (JsonNode contract : contracts) {
            known.put(contract.path("name").asText(), contract);
        }
        for (var entry : Map.copyOf(payload).entrySet()) {
            if (!known.containsKey(entry.getKey())) {
                errors.add(entry.getKey() + ": 未声明的参数");
            }
        }
        for (var entry : known.entrySet()) {
            var name = entry.getKey();
            var contract = entry.getValue();
            Object raw = payload.containsKey(name) ? payload.get(name)
                    : contract.hasNonNull("defaultValue") ? contract.get("defaultValue").asText() : null;
            if (raw == null || String.valueOf(raw).isBlank()) {
                if (contract.path("required").asBoolean(false)) {
                    errors.add(name + ": 必填");
                }
                continue;
            }
            var text = String.valueOf(raw).strip();
            var type = contract.path("type").asText("string");
            var allowed = contract.path("values");
            if (allowed.isArray() && allowed.size() > 0) {
                var inValues = false;
                for (JsonNode value : allowed) {
                    if (value.asText().equals(text)) {
                        inValues = true;
                        break;
                    }
                }
                if (!inValues) {
                    errors.add(name + ": 不在允许取值内");
                    continue;
                }
            }
            switch (type) {
                case "date" -> {
                    if (!DATE_PATTERN.matcher(text).matches()) {
                        errors.add(name + ": 须为 YYYY-MM-DD 日期");
                    } else {
                        try {
                            LocalDate.parse(text);
                            normalized.put(name, text);
                        } catch (DateTimeParseException exception) {
                            errors.add(name + ": 日期不存在");
                        }
                    }
                }
                case "number" -> {
                    try {
                        normalized.put(name, text.contains(".") ? (Object) Double.parseDouble(text)
                                : (Object) Long.parseLong(text));
                    } catch (NumberFormatException exception) {
                        errors.add(name + ": 须为数值");
                    }
                }
                case "boolean" -> {
                    if ("true".equalsIgnoreCase(text) || "false".equalsIgnoreCase(text)) {
                        normalized.put(name, Boolean.parseBoolean(text));
                    } else {
                        errors.add(name + ": 须为布尔");
                    }
                }
                default -> normalized.put(name, text);
            }
        }
        return new ParamValidation(normalized, errors);
    }

    private List<JsonNode> parseSchema(String schemaJson) {
        try {
            if (schemaJson == null || schemaJson.isBlank()) {
                return List.of();
            }
            return objectMapper.readTree(schemaJson) instanceof JsonNode node && node.isArray()
                    ? toList(node) : List.of();
        } catch (Exception exception) {
            return List.of();
        }
    }

    private static List<JsonNode> toList(JsonNode array) {
        var nodes = new ArrayList<JsonNode>(array.size());
        array.forEach(nodes::add);
        return nodes;
    }

    /** 回答模板渲染：{参数名} 与 {row_count}/{service_code}/{service_version}。 */
    private String renderTemplate(String template, Map<String, Object> params,
                                  AssistantDataApiClient.QueryResult result) {
        var rendered = template;
        for (var entry : params.entrySet()) {
            rendered = rendered.replace("{" + entry.getKey() + "}", String.valueOf(entry.getValue()));
        }
        rendered = rendered.replace("{row_count}", String.valueOf(result.rowCount()));
        rendered = rendered.replace("{service_code}", result.serviceCode());
        rendered = rendered.replace("{service_version}", result.serviceVersion());
        return rendered;
    }

    private String writeAudit(TenantScope.Scope scope, String questionText,
                              AssistantQuestion matched, Map<String, Object> params,
                              String outcome, String detail, int rowCount, int elapsedMs,
                              String serviceVersion) {
        var id = AssistantRepository.newId();
        String paramsJson;
        try {
            paramsJson = objectMapper.writeValueAsString(params);
        } catch (Exception exception) {
            paramsJson = "{}";
        }
        repository.insertAudit(new AssistantQueryAudit(id, scope.tenantId(),
                scope.institutionId(), scope.subject(),
                truncate(questionText, 512),
                matched == null ? "" : matched.code(),
                matched == null ? "" : matched.serviceCode(),
                serviceVersion, paramsJson, rowCount, elapsedMs, outcome,
                truncate(detail, 512), null, null, null, Instant.now()));
        return id;
    }

    private static String truncate(String value, int max) {
        if (value == null) {
            return "";
        }
        return value.length() <= max ? value : value.substring(0, max);
    }
}
