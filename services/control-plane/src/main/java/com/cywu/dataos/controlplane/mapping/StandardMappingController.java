package com.cywu.dataos.controlplane.mapping;

import java.net.URI;
import java.security.Principal;
import java.util.Map;

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
 * 标准映射公开 API（G23，接口清单见功能补齐计划）：映射集 CRUD / 版本生命周期 /
 * 导入（dry-run 先行）/ 聚合验证 / 生效（checksum 门控 + 指针 CAS）/ 回退 / 影响范围；
 * 另提供只读覆盖率投影（ai-ready fhir_mapping_coverage 与门户消费）。
 * 权限三级由 OidcSecurityConfiguration 承担（与数据标准同款）。
 */
@RestController
@RequestMapping("/api/v1")
public class StandardMappingController {

    private final MappingAdminService service;

    public StandardMappingController(MappingAdminService service) {
        this.service = service;
    }

    @GetMapping("/standard-mappings")
    public Map<String, Object> list(@RequestParam(required = false) String query,
                                    @RequestParam(defaultValue = "0") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(required = false) String tenantId) {
        return service.list(tenantId, query, page, size);
    }

    @PostMapping("/standard-mappings")
    public ResponseEntity<Map<String, Object>> create(@RequestBody CreateMappingSetRequest request,
                                                      @RequestParam(required = false) String tenantId,
                                                      Principal principal) {
        var created = service.create(tenantId, request, usernameOf(principal));
        var setId = String.valueOf(((Map<?, ?>) created.get("set")).get("id"));
        return ResponseEntity.created(URI.create("/api/v1/standard-mappings/" + setId))
                .body(created);
    }

    @GetMapping("/standard-mappings/coverage")
    public Map<String, Object> coverage(@RequestParam(required = false) String tenantId) {
        return service.coverage(tenantId);
    }

    @GetMapping("/standard-mappings/{id}")
    public Map<String, Object> detail(@PathVariable String id,
                                      @RequestParam(required = false) String versionId,
                                      @RequestParam(required = false) String tenantId) {
        return service.detail(tenantId, id, versionId);
    }

    @PostMapping("/standard-mappings/{id}/versions")
    public Map<String, Object> createVersion(@PathVariable String id,
                                             @RequestBody(required = false) Map<String, String> request,
                                             @RequestParam(required = false) String tenantId,
                                             Principal principal) {
        return service.createVersion(tenantId, id,
                request == null ? null : request.get("baseVersionId"), usernameOf(principal));
    }

    @PostMapping("/standard-mappings/{id}/rollback/{versionId}")
    public Map<String, Object> rollback(@PathVariable String id, @PathVariable String versionId,
                                        @RequestParam(required = false) String tenantId,
                                        Principal principal) {
        return service.rollback(tenantId, id, versionId, usernameOf(principal));
    }

    @PutMapping("/standard-mapping-versions/{versionId}")
    public Map<String, Object> updateVersion(@PathVariable String versionId,
                                             @RequestBody UpdateMappingVersionRequest request,
                                             @RequestParam(required = false) String tenantId,
                                             Principal principal) {
        return service.updateVersion(tenantId, versionId, request, usernameOf(principal));
    }

    /** 导入映射项（CSV 模板或内部 JSON；dry-run 先行；仅 DRAFT）。 */
    @PostMapping(value = "/standard-mapping-versions/{versionId}/import",
            consumes = {"text/csv", MediaType.APPLICATION_JSON_VALUE})
    public Map<String, Object> importItems(@PathVariable String versionId,
                                           @RequestParam(defaultValue = "true") boolean dryRun,
                                           @RequestParam(required = false) String tenantId,
                                           @RequestBody String body,
                                           Principal principal) {
        return service.importItems(tenantId, versionId, body, dryRun, usernameOf(principal));
    }

    @PostMapping("/standard-mapping-versions/{versionId}/validate")
    public Map<String, Object> validate(@PathVariable String versionId,
                                        @RequestParam(required = false) String tenantId,
                                        Principal principal) {
        return service.validate(tenantId, versionId, usernameOf(principal));
    }

    @PostMapping("/standard-mapping-versions/{versionId}/submit")
    public Map<String, Object> submit(@PathVariable String versionId,
                                      @RequestParam(required = false) String tenantId,
                                      Principal principal) {
        return service.submit(tenantId, versionId, usernameOf(principal));
    }

    @PostMapping("/standard-mapping-versions/{versionId}/activate")
    public Map<String, Object> activate(@PathVariable String versionId,
                                        @RequestParam(required = false) String tenantId,
                                        Principal principal) {
        return service.activate(tenantId, versionId, usernameOf(principal));
    }

    @PostMapping("/standard-mapping-versions/{versionId}/retire")
    public Map<String, Object> retire(@PathVariable String versionId,
                                      @RequestParam(required = false) String tenantId,
                                      Principal principal) {
        return service.retire(tenantId, versionId, usernameOf(principal));
    }

    @GetMapping("/standard-mapping-versions/{versionId}/impact")
    public Map<String, Object> impact(@PathVariable String versionId,
                                      @RequestParam(required = false) String tenantId) {
        return service.impact(tenantId, versionId);
    }

    private static String usernameOf(Principal principal) {
        if (principal instanceof org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken jwtAuth) {
            var claims = jwtAuth.getToken().getClaims();
            for (var claim : java.util.List.of("preferred_username", "sub")) {
                var value = claims.get(claim);
                if (value != null && !String.valueOf(value).isBlank() && !"null".equals(value)) {
                    return String.valueOf(value);
                }
            }
        }
        return "system";
    }
}
