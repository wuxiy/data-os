package com.cywu.dataos.controlplane.lineage;

import java.util.Map;
import java.util.function.Function;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 门户血缘/资产读 API（OpenMetadata 适配）。未配置 data-os.openmetadata.base-url
 * 时整链不装配，端点返回 503（与 MPI 访问链同一降级语义）。
 */
@RestController
@RequestMapping("/api/v1")
public class LineageController {

    private final ObjectProvider<LineageAssetService> service;

    public LineageController(ObjectProvider<LineageAssetService> service) {
        this.service = service;
    }

    @GetMapping("/assets")
    public ResponseEntity<?> assets(@RequestParam(required = false) String schema) {
        return withService(target -> target.listAssets(schema));
    }

    @GetMapping("/assets/{fullyQualifiedName}")
    public ResponseEntity<?> asset(@PathVariable String fullyQualifiedName) {
        return withService(target -> target.getAsset(fullyQualifiedName));
    }

    @GetMapping("/assets/{fullyQualifiedName}/lineage")
    public ResponseEntity<?> lineage(@PathVariable String fullyQualifiedName) {
        return withService(target -> target.getLineage(fullyQualifiedName));
    }

    @GetMapping("/lineage/summary")
    public ResponseEntity<?> summary() {
        return withService(LineageAssetService::summary);
    }

    private ResponseEntity<?> withService(Function<LineageAssetService, Object> call) {
        var target = service.getIfAvailable();
        if (target == null) {
            return ResponseEntity.status(503).body(Map.of(
                    "code", 503,
                    "message", "血缘服务未配置：请在控制面设置 data-os.openmetadata.base-url 后重启"));
        }
        try {
            return ResponseEntity.ok(call.apply(target));
        } catch (AdapterUnavailableException exception) {
            return ResponseEntity.status(503).body(Map.of("code", 503, "message", "OpenMetadata 暂时不可用"));
        } catch (IllegalStateException exception) {
            return ResponseEntity.status(404).body(Map.of("code", 404, "message", exception.getMessage()));
        }
    }
}
