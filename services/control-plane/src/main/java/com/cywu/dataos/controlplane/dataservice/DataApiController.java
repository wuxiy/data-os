package com.cywu.dataos.controlplane.dataservice;

import java.net.URI;
import java.util.List;
import java.util.Map;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 数据服务管理面 API（G13 方案 §五）。OIDC 保护 {@code /api/**}，
 * 角色口径与 ai-data-products 一致：读全员、写 engineering、Key 发放
 * 收紧到 admin。
 */
@RestController
@RequestMapping("/api/v1/data-services")
public class DataApiController {

    private final DataApiAdminService service;

    public DataApiController(DataApiAdminService service) {
        this.service = service;
    }

    @GetMapping
    public Map<String, Object> list(@RequestParam(required = false) String tenantId) {
        var items = service.list(tenantId);
        return Map.of("items", items, "total", items.size());
    }

    @PostMapping
    public ResponseEntity<DataServiceDefinition> create(@Valid @RequestBody CreateDataServiceRequest request,
                                                        @RequestParam(required = false) String tenantId) {
        var definition = service.create(tenantId, request);
        return ResponseEntity
                .created(URI.create("/api/v1/data-services/" + definition.id()))
                .body(definition);
    }

    @GetMapping("/{id}")
    public DataApiAdminService.DataServiceDetail detail(@PathVariable String id,
                                                        @RequestParam(required = false) String tenantId) {
        return service.detail(id, tenantId);
    }

    @PostMapping("/{id}/publish")
    public DataServiceDefinition publish(@PathVariable String id,
                                         @RequestParam(required = false) String tenantId) {
        return service.publish(id, tenantId);
    }

    @PostMapping("/{id}/deprecate")
    public DataServiceDefinition deprecate(@PathVariable String id,
                                           @RequestParam(required = false) String tenantId) {
        return service.deprecate(id, tenantId);
    }

    @PostMapping("/{id}/keys")
    public ResponseEntity<DataApiAdminService.IssuedKey> issueKey(@PathVariable String id,
                                                                  @RequestBody KeyRequest request,
                                                                  @RequestParam(required = false) String tenantId) {
        var key = service.issueKey(id, tenantId, request.callerName(),
                request.allowedHospitals(), request.dailyQuota());
        return ResponseEntity.created(URI.create("/api/v1/data-services/" + id + "/keys/" + key.keyId()))
                .body(key);
    }

    @DeleteMapping("/{id}/keys/{keyId}")
    public ResponseEntity<Void> revokeKey(@PathVariable String id, @PathVariable String keyId,
                                          @RequestParam(required = false) String tenantId) {
        service.revokeKey(id, keyId, tenantId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/calls")
    public Map<String, Object> calls(@PathVariable String id,
                                     @RequestParam(defaultValue = "20") int limit,
                                     @RequestParam(required = false) String tenantId) {
        var items = service.calls(id, tenantId, limit);
        return Map.of("items", items, "total", items.size());
    }

    /** 导出任务列表（P7）：工作台查看异步导出的状态与产物。 */
    @GetMapping("/{id}/exports")
    public Map<String, Object> exports(@PathVariable String id,
                                       @RequestParam(defaultValue = "20") int limit,
                                       @RequestParam(required = false) String tenantId) {
        var items = service.exports(id, tenantId, limit);
        return Map.of("items", items, "total", items.size());
    }

    @GetMapping("/overview")
    public Map<String, Object> overview(@RequestParam(required = false) String tenantId) {
        return service.overview(tenantId);
    }

    public record KeyRequest(String callerName, List<String> allowedHospitals, int dailyQuota) {
    }
}
