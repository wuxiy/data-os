package com.cywu.dataos.controlplane.standard;

import java.io.BufferedReader;
import java.io.StringReader;
import java.net.URI;
import java.security.Principal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 数据标准公开 API（G22，接口清单见功能补齐计划）：列表/详情/版本生命周期/
 * 导入（dry-run 先行）/对比/影响/FHIR 导出。权限三级由 OidcSecurityConfiguration
 * 承担（读=六角色，起草/提交=工程师及以上，发布/停用/重试同步=管理员）。
 */
@RestController
@RequestMapping("/api/v1")
public class StandardController {

    private final StandardAdminService service;

    public StandardController(StandardAdminService service) {
        this.service = service;
    }

    @GetMapping("/data-standards")
    public Map<String, Object> list(@RequestParam(required = false) String query,
                                    @RequestParam(required = false) String status,
                                    @RequestParam(defaultValue = "0") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(required = false) String tenantId) {
        return service.list(tenantId, query, status, page, size);
    }

    @PostMapping("/data-standards")
    public ResponseEntity<Map<String, Object>> create(@RequestBody CreateStandardRequest request,
                                                      @RequestParam(required = false) String tenantId,
                                                      Principal principal) {
        var created = service.create(tenantId, request, usernameOf(principal));
        var standardId = String.valueOf(((Map<?, ?>) created.get("standard")).get("id"));
        return ResponseEntity.created(URI.create("/api/v1/data-standards/" + standardId))
                .body(created);
    }

    @GetMapping("/data-standards/{id}")
    public Map<String, Object> detail(@PathVariable String id,
                                      @RequestParam(required = false) String versionId,
                                      @RequestParam(required = false) String tenantId) {
        return service.detail(tenantId, id, versionId);
    }

    @PostMapping("/data-standards/{id}/versions")
    public Map<String, Object> createVersion(@PathVariable String id,
                                             @RequestBody(required = false) CreateVersionRequest request,
                                             @RequestParam(required = false) String tenantId,
                                             Principal principal) {
        return service.createVersion(tenantId, id,
                request == null ? null : request.baseVersionId(), usernameOf(principal));
    }

    @PutMapping("/data-standard-versions/{versionId}")
    public Map<String, Object> updateVersion(@PathVariable String versionId,
                                             @RequestBody UpdateStandardVersionRequest request,
                                             @RequestParam(required = false) String tenantId,
                                             Principal principal) {
        return service.updateVersion(tenantId, versionId, request, usernameOf(principal));
    }

    @PostMapping("/data-standard-versions/{versionId}/submit")
    public Map<String, Object> submit(@PathVariable String versionId,
                                      @RequestParam(required = false) String tenantId,
                                      Principal principal) {
        return service.submit(tenantId, versionId, usernameOf(principal));
    }

    @PostMapping("/data-standard-versions/{versionId}/publish")
    public Map<String, Object> publish(@PathVariable String versionId,
                                       @RequestParam(required = false) String tenantId,
                                       Principal principal) {
        return service.publish(tenantId, versionId, usernameOf(principal));
    }

    @PostMapping("/data-standard-versions/{versionId}/deprecate")
    public Map<String, Object> deprecate(@PathVariable String versionId,
                                         @RequestParam(required = false) String tenantId,
                                         Principal principal) {
        return service.deprecate(tenantId, versionId, usernameOf(principal));
    }

    /** SYNC_PENDING 人工重试（G22「不伪造成功」的闭环；不在固定 12 端点内，属运维补口）。 */
    @PostMapping("/data-standard-versions/{versionId}/sync")
    public Map<String, Object> retrySync(@PathVariable String versionId,
                                         @RequestParam(required = false) String tenantId,
                                         Principal principal) {
        return service.retrySync(tenantId, versionId, usernameOf(principal));
    }

    /** 导入：Content-Type text/csv（平台模板）或 application/json（内部 Schema）。 */
    @PostMapping(value = "/data-standards/import", consumes = {"text/csv",
            MediaType.APPLICATION_JSON_VALUE})
    public Map<String, Object> importStandards(@RequestParam(defaultValue = "true") boolean dryRun,
                                               @RequestParam(required = false) Integer versionNo,
                                               @RequestParam(required = false) String tenantId,
                                               @RequestBody String body,
                                               Principal principal) {
        // consumes 约束了两种类型；此处按内容特征再解析一次以复用同一 DTO
        CreateStandardRequest request;
        if (body.trim().startsWith("{")) {
            request = parseJson(body);
        } else {
            request = parseCsv(body);
        }
        return service.importStandards(tenantId, request, versionNo, dryRun, usernameOf(principal));
    }

    @GetMapping("/data-standard-versions/{versionId}/compare/{otherVersionId}")
    public Map<String, Object> compare(@PathVariable String versionId,
                                       @PathVariable String otherVersionId,
                                       @RequestParam(required = false) String tenantId) {
        return service.compare(tenantId, versionId, otherVersionId);
    }

    @GetMapping("/data-standard-versions/{versionId}/impact")
    public Map<String, Object> impact(@PathVariable String versionId,
                                      @RequestParam(required = false) String tenantId) {
        return service.impact(tenantId, versionId);
    }

    @GetMapping("/data-standard-versions/{versionId}/fhir-bundle")
    public Map<String, Object> fhirBundle(@PathVariable String versionId,
                                          @RequestParam(required = false) String tenantId) {
        return service.fhirBundle(tenantId, versionId);
    }

    // ---- 导入解析 ----

    /** 平台 CSV 模板：列 standard_code,standard_name,element_code,element_name,data_type,
     *  required,definition,sensitivity,value_code,value_display（值域按行展开）。 */
    static CreateStandardRequest parseCsv(String csv) {
        var rows = parseCsvRows(csv);
        if (rows.isEmpty()) {
            throw new InvalidRequestException("CSV 内容为空");
        }
        var header = rows.get(0).stream().map(String::trim).map(String::toLowerCase).toList();
        var required = List.of("standard_code", "standard_name", "element_code",
                "element_name", "data_type", "required");
        var missing = required.stream().filter(column -> !header.contains(column)).toList();
        if (!missing.isEmpty()) {
            throw new InvalidRequestException("CSV 缺少必需列: " + missing);
        }
        var column = new LinkedHashMap<String, Integer>();
        for (int i = 0; i < header.size(); i++) {
            column.put(header.get(i), i);
        }
        String standardCode = null;
        String standardName = null;
        var elements = new ArrayList<CreateStandardRequest.ElementContract>();
        var elementsByCode = new LinkedHashMap<String, CreateStandardRequest.ElementContract>();
        for (int r = 1; r < rows.size(); r++) {
            var row = rows.get(r);
            java.util.function.Function<String, String> cell = name -> {
                var index = column.get(name);
                return index == null || index >= row.size() ? "" : row.get(index).trim();
            };
            if (row.stream().allMatch(value -> value == null || value.trim().isBlank())) {
                continue;
            }
            var rowStandardCode = cell.apply("standard_code");
            if (rowStandardCode.isBlank()) {
                throw new InvalidRequestException("CSV 第 " + (r + 1) + " 行 standard_code 为空");
            }
            if (standardCode == null) {
                standardCode = rowStandardCode;
                standardName = cell.apply("standard_name");
            } else if (!standardCode.equals(rowStandardCode)) {
                throw new InvalidRequestException(
                        "CSV 第 " + (r + 1) + " 行混入第二个标准 " + rowStandardCode + "（单文件单标准）");
            }
            var elementCode = cell.apply("element_code");
            if (elementCode.isBlank()) {
                throw new InvalidRequestException("CSV 第 " + (r + 1) + " 行 element_code 为空");
            }
            var valueCode = cell.apply("value_code");
            var valueDisplay = cell.apply("value_display");
            var existing = elementsByCode.get(elementCode);
            if (existing == null) {
                var values = new ArrayList<CreateStandardRequest.ValueContract>();  // 后续值域行会追加
                if (!valueCode.isBlank()) {
                    values.add(new CreateStandardRequest.ValueContract(valueCode,
                            valueDisplay.isBlank() ? valueCode : valueDisplay,
                            cell.apply("valid_from"), cell.apply("valid_to")));
                }
                var element = new CreateStandardRequest.ElementContract(
                        elementCode, cell.apply("element_name"), cell.apply("data_type"),
                        "true".equalsIgnoreCase(cell.apply("required")) || "1".equals(cell.apply("required")),
                        cell.apply("definition"), cell.apply("sensitivity"), "", values);
                elementsByCode.put(elementCode, element);
                elements.add(element);
            } else if (!valueCode.isBlank()) {
                existing.values().add(new CreateStandardRequest.ValueContract(valueCode,
                        valueDisplay.isBlank() ? valueCode : valueDisplay,
                        cell.apply("valid_from"), cell.apply("valid_to")));
            }
        }
        if (standardCode == null) {
            throw new InvalidRequestException("CSV 无数据行");
        }
        return new CreateStandardRequest(standardCode,
                standardName == null || standardName.isBlank() ? standardCode : standardName,
                "", "", elements);
    }

    private static CreateStandardRequest parseJson(String body) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(body, CreateStandardRequest.class);
    // json 解析失败给出可操作的文案
        } catch (com.fasterxml.jackson.core.JsonProcessingException failure) {
            throw new InvalidRequestException("JSON 导入体解析失败: " + failure.getOriginalMessage());
        }
    }

    /** 最小 RFC4180 解析（引号包裹与转义；无第三方依赖）。 */
    public static List<List<String>> parseCsvRows(String csv) {
        var rows = new ArrayList<List<String>>();
        var current = new ArrayList<String>();
        var field = new StringBuilder();
        var inQuotes = false;
        var fieldStarted = false;
        var text = csv == null ? "" : csv;
        for (int i = 0; i < text.length(); i++) {
            var ch = text.charAt(i);
            if (inQuotes) {
                if (ch == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        field.append('"');
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field.append(ch);
                }
            } else if (ch == '"') {
                inQuotes = true;
                fieldStarted = true;
            } else if (ch == ',') {
                current.add(field.toString());
                field.setLength(0);
                fieldStarted = true;
            } else if (ch == '\n' || ch == '\r') {
                if (ch == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') {
                    i++;
                }
                current.add(field.toString());
                field.setLength(0);
                if (!current.stream().allMatch(value -> value.trim().isEmpty()) || fieldStarted) {
                    rows.add(List.copyOf(current));
                }
                current = new ArrayList<>();
                fieldStarted = false;
            } else {
                field.append(ch);
                fieldStarted = true;
            }
        }
        if (field.length() > 0 || !current.isEmpty() || fieldStarted) {
            current.add(field.toString());
            rows.add(List.copyOf(current));
        }
        return rows;
    }

    /** ENFORCED 取 JWT 身份（preferred_username 优先）；DISABLED/匿名回落 system。 */
    private static String usernameOf(Principal principal) {
        if (principal instanceof org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken jwtAuth) {
            var claims = jwtAuth.getToken().getClaims();
            for (var claim : List.of("preferred_username", "sub")) {
                var value = claims.get(claim);
                if (value != null && !String.valueOf(value).isBlank() && !"null".equals(value)) {
                    return String.valueOf(value);
                }
            }
        }
        return "system";
    }

    public record CreateVersionRequest(String baseVersionId) {
    }
}
