package com.cywu.dataos.controlplane.assistant;

import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.constraints.NotBlank;

/**
 * 受控智能问数公开 API（G26 固定三接口：问题清单 / 提问（含拒答信封）/
 * 反馈（回写审计行））+ 治理面（G27：问题生命周期管理）。权限沿用 /api/**
 * 认证基线（全部已认证角色可用）；治理面角色在安全配置声明（发布/停用=管理员）；
 * 租户与机构范围经 TenantScope 解析，越租户参数 403。
 */
@RestController
@RequestMapping("/api/v1/assistant")
public class AssistantController {

    private final AssistantAdminService service;

    public AssistantController(AssistantAdminService service) {
        this.service = service;
    }

    @GetMapping("/questions")
    public Map<String, Object> questions(@RequestParam(required = false) String tenantId) {
        return service.questions(tenantId);
    }

    public record QueryRequest(@NotBlank String text, Map<String, Object> parameters) {
    }

    @PostMapping("/query")
    public Map<String, Object> query(@RequestBody QueryRequest request,
                                     @RequestParam(required = false) String tenantId) {
        return service.query(tenantId, request.text(), request.parameters());
    }

    public record FeedbackRequest(@NotBlank String auditId, @NotBlank String rating, String note) {
    }

    @PostMapping("/feedback")
    public Map<String, Object> feedback(@RequestBody FeedbackRequest request,
                                        @RequestParam(required = false) String tenantId) {
        return service.feedback(tenantId, request.auditId(), request.rating(), request.note());
    }

    // ---- 治理面（G27）：问题生命周期 ----

    @GetMapping("/admin/questions")
    public Map<String, Object> adminQuestions(@RequestParam(required = false) String tenantId) {
        return service.adminQuestions(tenantId);
    }

    @PostMapping("/admin/questions")
    public Map<String, Object> createQuestion(@RequestBody AssistantAdminService.QuestionDraft draft,
                                              @RequestParam(required = false) String tenantId) {
        return service.createQuestion(tenantId, draft);
    }

    @PutMapping("/admin/questions/{code}")
    public Map<String, Object> updateQuestion(@PathVariable String code,
                                              @RequestBody AssistantAdminService.QuestionDraft draft,
                                              @RequestParam(required = false) String tenantId) {
        return service.updateQuestion(tenantId, code, draft);
    }

    @PostMapping("/admin/questions/{code}/publish")
    public Map<String, Object> publishQuestion(@PathVariable String code,
                                               @RequestParam(required = false) String tenantId) {
        return service.publishQuestion(tenantId, code);
    }

    @PostMapping("/admin/questions/{code}/deprecate")
    public Map<String, Object> deprecateQuestion(@PathVariable String code,
                                                 @RequestParam(required = false) String tenantId) {
        return service.deprecateQuestion(tenantId, code);
    }

    @PostMapping("/admin/questions/{code}/reopen")
    public Map<String, Object> reopenQuestion(@PathVariable String code,
                                              @RequestParam(required = false) String tenantId) {
        return service.reopenQuestion(tenantId, code);
    }

    @DeleteMapping("/admin/questions/{code}")
    public Map<String, Object> deleteQuestion(@PathVariable String code,
                                              @RequestParam(required = false) String tenantId) {
        return service.deleteQuestion(tenantId, code);
    }

    public record TestRequest(Map<String, Object> parameters) {
    }

    @PostMapping("/admin/questions/{code}/test")
    public Map<String, Object> testQuestion(@PathVariable String code,
                                            @RequestBody TestRequest request,
                                            @RequestParam(required = false) String tenantId) {
        return service.testQuestion(tenantId, code,
                request == null ? null : request.parameters());
    }

    @GetMapping("/admin/questions/{code}/events")
    public Map<String, Object> questionEvents(@PathVariable String code,
                                              @RequestParam(required = false, defaultValue = "100") int limit,
                                              @RequestParam(required = false) String tenantId) {
        return service.questionEvents(tenantId, code, limit);
    }

    // ---- 审计管理面（G27 余项）----

    @GetMapping("/admin/audits")
    public Map<String, Object> audits(@RequestParam(required = false, defaultValue = "") String outcome,
                                      @RequestParam(required = false, defaultValue = "0") int page,
                                      @RequestParam(required = false, defaultValue = "20") int pageSize,
                                      @RequestParam(required = false) String tenantId) {
        return service.audits(tenantId, outcome, page, pageSize);
    }

    @GetMapping(value = "/admin/audits/export", produces = "text/csv")
    public org.springframework.http.ResponseEntity<String> auditExport(
            @RequestParam(required = false, defaultValue = "") String outcome,
            @RequestParam(required = false) String tenantId) {
        var body = service.auditCsv(tenantId, outcome);
        return org.springframework.http.ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=assistant-audits.csv")
                .body(body);
    }
}
