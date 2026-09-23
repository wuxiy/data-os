package com.cywu.dataos.controlplane.assistant;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

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
        var validation = validateParams(matched, params);
        if (!validation.errors().isEmpty()) {
            return refused(scope, questionText, "REFUSED_PARAM_INVALID",
                    "参数不满足问题 Schema: " + String.join("; ", validation.errors()), questions,
                    matched, validation.normalized());
        }
        if (!dataApi.configured()) {
            return refused(scope, questionText, "REFUSED_UNAVAILABLE",
                    "问数执行面未配置或服务身份不可用（data-os.assistant.*）", questions,
                    matched, validation.normalized());
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
                    matched, validation.normalized());
        } catch (AdapterUnavailableException exception) {
            return refused(scope, questionText, "REFUSED_UNAVAILABLE", exception.getMessage(),
                    questions, matched, validation.normalized());
        }

        var auditId = writeAudit(scope, questionText, matched, validation.normalized(),
                "ANSWERED", "", result.rowCount(), result.elapsedMs(), result.serviceVersion());
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
        return answer;
    }

    /** 拒答信封（审计留痕 + 支持问题提示，绝不回退演示答案）。 */
    private Map<String, Object> refused(TenantScope.Scope scope, String questionText,
                                        String outcome, String reason,
                                        List<AssistantQuestion> questions) {
        return refused(scope, questionText, outcome, reason, questions, null, Map.of());
    }

    private Map<String, Object> refused(TenantScope.Scope scope, String questionText,
                                        String outcome, String reason,
                                        List<AssistantQuestion> questions,
                                        AssistantQuestion matched, Map<String, Object> params) {
        var auditId = writeAudit(scope, questionText, matched, params, outcome, reason, 0, 0, "");
        var answer = new LinkedHashMap<String, Object>();
        answer.put("answered", false);
        answer.put("auditId", auditId);
        answer.put("outcome", outcome);
        answer.put("reason", reason);
        answer.put("supportedQuestions", questions.stream().map(AssistantQuestion::question).toList());
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
