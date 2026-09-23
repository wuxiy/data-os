package com.cywu.dataos.controlplane.assistant;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.validation.constraints.NotBlank;

/**
 * 受控智能问数公开 API（G26，固定三接口）：问题清单 / 提问（含拒答信封）/
 * 反馈（回写审计行）。权限沿用 /api/** 认证基线（全部已认证角色可用）；
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
}
