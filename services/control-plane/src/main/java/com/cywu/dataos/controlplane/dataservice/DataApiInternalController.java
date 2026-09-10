package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;
import java.util.Map;

import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 执行面内部端点（G13 方案 §五）：data-api 服务的 registry 拉取与审计回写，
 * 以及导出任务驱动（P7，H3）。认证由 {@code OidcSecurityConfiguration} 的
 * {@code /internal/data-api/**} authenticated() 规则承担——仅接受
 * audience=data-os 的服务 token（Keycloak client dataos-data-api +
 * audience mapper）。
 */
@RestController
@RequestMapping("/internal/data-api")
public class DataApiInternalController {

    private final DataApiAdminService service;

    public DataApiInternalController(DataApiAdminService service) {
        this.service = service;
    }

    @GetMapping("/registry")
    public Map<String, Object> registry() {
        return service.registry();
    }

    @PostMapping("/calls")
    public Map<String, Object> recordCall(@RequestBody CallReport report) {
        var accepted = service.recordCall(report.code(), report.keyHash(), report.parametersJson(),
                report.rowCount(), report.truncated(), report.elapsedMs(), report.statusCode(),
                report.idempotencyKey(), report.kindOrDefault());
        return Map.of("accepted", accepted);
    }

    // ---- 导出任务驱动（P7）----

    @PostMapping("/exports")
    public Map<String, Object> createExport(@RequestBody ExportRequest request) {
        var export = service.createExport(request.code(), request.keyHash(), request.parametersJson());
        return Map.of("id", export.id(), "status", export.status().name());
    }

    // ---- 调用方自助面（P8 余项）：data-api 经服务 token 代理 ----

    @GetMapping("/keys/{keyHash}/profile")
    public Map<String, Object> keyProfile(@PathVariable String keyHash) {
        return service.keyProfile(keyHash);
    }

    @GetMapping("/keys/{keyHash}/calls")
    public Map<String, Object> keyCalls(@PathVariable String keyHash,
                                        @RequestParam(defaultValue = "20") int limit) {
        var items = service.keyCalls(keyHash, limit);
        return Map.of("items", items, "total", items.size());
    }

    @PostMapping("/subscriptions")
    public Map<String, Object> createSubscription(@RequestBody SubscriptionRequest request) {
        var issued = service.createSubscription(request.keyHash(), request.webhookUrl(),
                request.webhookSecret());
        return Map.of("subscriptionId", issued.subscriptionId(), "webhookUrl", issued.webhookUrl(),
                "webhookSecret", issued.webhookSecret(), "createdAt", issued.createdAt());
    }

    @GetMapping("/subscriptions")
    public Map<String, Object> subscriptions(@RequestParam String keyHash) {
        var items = service.subscriptionsByKeyHash(keyHash);
        return Map.of("items", items, "total", items.size());
    }

    @DeleteMapping("/subscriptions/{id}")
    public ResponseEntity<Void> revokeSubscription(@PathVariable String id, @RequestParam String keyHash) {
        service.revokeSubscription(id, keyHash);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/subscriptions/{id}/test")
    public Map<String, Object> testSubscription(@PathVariable String id, @RequestParam String keyHash) {
        return service.testSubscription(id, keyHash);
    }

    @GetMapping("/contract-events")
    public Map<String, Object> contractEvents(@RequestParam String keyHash,
                                              @RequestParam(defaultValue = "50") int limit) {
        var items = service.contractEventsByKeyHash(keyHash, limit);
        return Map.of("items", items, "total", items.size());
    }

    @GetMapping("/exports/pending")
    public Map<String, Object> pendingExports() {
        var items = service.findPendingExports().stream()
                .map(export -> exportProjection(export)).toList();
        return Map.of("items", items);
    }

    @GetMapping("/exports/{id}")
    public Map<String, Object> getExport(@PathVariable String id) {
        var export = service.findExport(id)
                .orElseThrow(() -> new ResourceNotFoundException("导出任务不存在: " + id));
        return exportProjection(export);
    }

    @PatchMapping("/exports/{id}")
    public Map<String, Object> updateExport(@PathVariable String id, @RequestBody ExportUpdate update) {
        switch (update.action()) {
            case "claim" -> service.claimExport(id);
            case "finalize" -> service.finalizeExport(id,
                    DataServiceExport.ExportStatus.valueOf(update.target()),
                    update.rowCountOrDefault(), update.fileBytes(), update.artifactUri(),
                    update.error(), update.expiresAt() == null || update.expiresAt().isBlank()
                            ? null : Instant.parse(update.expiresAt()));
            default -> throw new IllegalArgumentException("未知导出动作: " + update.action());
        }
        var export = service.findExport(id)
                .orElseThrow(() -> new ResourceNotFoundException("导出任务不存在: " + id));
        return exportProjection(export);
    }

    @PostMapping("/exports/expire")
    public Map<String, Object> expireExports() {
        return Map.of("expired", service.expireExports());
    }

    @PostMapping("/exports/reap-stale")
    public Map<String, Object> reapStale(@RequestBody ReapStaleRequest request) {
        return Map.of("reaped", service.reapStaleRunning(Instant.parse(request.staleBefore())));
    }

    private Map<String, Object> exportProjection(DataServiceExport export) {
        return service.exportProjection(export);
    }

    public record CallReport(String code, String keyHash, String parametersJson, int rowCount,
                             boolean truncated, int elapsedMs, int statusCode, String idempotencyKey,
                             String kind) {

        public String kindOrDefault() {
            return kind == null || kind.isBlank() ? "query" : kind;
        }
    }

    public record ExportRequest(String code, String keyHash, String parametersJson) {
    }

    public record SubscriptionRequest(String keyHash, String webhookUrl, String webhookSecret) {
    }

    public record ExportUpdate(String action, String target, Long rowCount, Long fileBytes,
                               String artifactUri, String error, String expiresAt) {

        public long rowCountOrDefault() {
            return rowCount == null ? 0 : rowCount;
        }
    }

    public record ReapStaleRequest(String staleBefore) {
    }
}
