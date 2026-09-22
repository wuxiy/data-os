package com.cywu.dataos.controlplane.delivery;

import java.net.URI;
import java.security.Principal;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 交付中心公开 API（G25，接口清单见功能补齐计划）：项目 CRUD / 交付项 /
 * 逐项可交付性检查（submit 内嵌）/ 不可变证据快照 / 验收与归档 / 证据包下载。
 * 快照与状态动作要求 Idempotency-Key（缺失 400，重放幂等）。
 * 权限三级由 OidcSecurityConfiguration 承担（与标准映射同款）。
 */
@RestController
@RequestMapping("/api/v1")
public class DeliveryController {

    private final DeliveryAdminService service;
    private final com.cywu.dataos.controlplane.security.TenantScope tenantScope;

    public DeliveryController(DeliveryAdminService service,
                              com.cywu.dataos.controlplane.security.TenantScope tenantScope) {
        this.service = service;
        this.tenantScope = tenantScope;
    }

    @GetMapping("/deliveries")
    public Map<String, Object> list(@RequestParam(required = false) String query,
                                    @RequestParam(defaultValue = "0") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(required = false) String tenantId) {
        return service.list(tenantScope(tenantId), query, page, size);
    }

    @PostMapping("/deliveries")
    public ResponseEntity<Map<String, Object>> create(@RequestBody CreateDeliveryRequest request,
                                                      @RequestParam(required = false) String tenantId,
                                                      Principal principal) {
        var created = service.create(tenantScope(tenantId), request, usernameOf(principal));
        var projectId = String.valueOf(((Map<?, ?>) created.get("project")).get("id"));
        return ResponseEntity.created(URI.create("/api/v1/deliveries/" + projectId))
                .body(created);
    }

    @GetMapping("/deliveries/{id}")
    public Map<String, Object> detail(@PathVariable String id,
                                      @RequestParam(required = false) String tenantId) {
        return service.detail(tenantScope(tenantId), id);
    }

    @PutMapping("/deliveries/{id}")
    public Map<String, Object> update(@PathVariable String id,
                                      @RequestBody UpdateDeliveryRequest request,
                                      @RequestParam(required = false) String tenantId,
                                      Principal principal) {
        return service.update(tenantScope(tenantId), id, request, usernameOf(principal));
    }

    @PostMapping("/deliveries/{id}/items")
    public Map<String, Object> addItem(@PathVariable String id,
                                       @RequestBody AddDeliveryItemRequest request,
                                       @RequestParam(required = false) String tenantId,
                                       Principal principal) {
        return service.addItem(tenantScope(tenantId), id, request, usernameOf(principal));
    }

    @DeleteMapping("/deliveries/{id}/items/{itemId}")
    public Map<String, Object> removeItem(@PathVariable String id, @PathVariable String itemId,
                                          @RequestParam(required = false) String tenantId,
                                          Principal principal) {
        return service.removeItem(tenantScope(tenantId), id, itemId, usernameOf(principal));
    }

    @PostMapping("/deliveries/{id}/start")
    public Map<String, Object> start(@PathVariable String id,
                                     @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                     @RequestParam(required = false) String tenantId,
                                     Principal principal) {
        return service.start(tenantScope(tenantId), id, key, usernameOf(principal));
    }

    @PostMapping("/deliveries/{id}/submit")
    public Map<String, Object> submit(@PathVariable String id,
                                      @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                      @RequestParam(required = false) String tenantId,
                                      Principal principal) {
        return service.submit(tenantScope(tenantId), id, key, usernameOf(principal));
    }

    @PostMapping("/deliveries/{id}/snapshot")
    public Map<String, Object> snapshot(@PathVariable String id,
                                        @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                        @RequestParam(required = false) String tenantId,
                                        Principal principal) {
        return service.snapshot(tenantScope(tenantId), id, key, usernameOf(principal));
    }

    @PostMapping("/deliveries/{id}/accept")
    public Map<String, Object> accept(@PathVariable String id,
                                      @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                      @RequestParam(required = false) String tenantId,
                                      Principal principal) {
        return service.accept(tenantScope(tenantId), id, key, usernameOf(principal));
    }

    @PostMapping("/deliveries/{id}/archive")
    public Map<String, Object> archive(@PathVariable String id,
                                       @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                       @RequestParam(required = false) String tenantId,
                                       Principal principal) {
        return service.archive(tenantScope(tenantId), id, key, usernameOf(principal));
    }

    @GetMapping(value = "/deliveries/{id}/evidence.zip", produces = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public ResponseEntity<byte[]> evidenceZip(@PathVariable String id,
                                              @RequestParam(required = false) String tenantId) {
        var pack = service.evidenceZip(tenantScope(tenantId), id);
        return ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"" + pack.filename() + "\"")
                .contentType(MediaType.parseMediaType(MediaType.APPLICATION_OCTET_STREAM_VALUE))
                .body(pack.zipBytes());
    }

    // ---- 通用 ----

    private String tenantScope(String requestedTenant) {
        return tenantScope.resolve(requestedTenant, null).tenantId();
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
