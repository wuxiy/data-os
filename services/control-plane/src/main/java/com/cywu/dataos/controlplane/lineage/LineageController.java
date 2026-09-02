package com.cywu.dataos.controlplane.lineage;

import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 门户血缘/资产读 API（OpenMetadata 适配）。未配置 data-os.openmetadata.base-url
 * 时整链不装配，端点经中央异常出口返回 503（ProblemDetail）——降级语义的
 * 唯一属主是 ApiExceptionHandler，controller 不再手拼响应体。
 */
@RestController
@RequestMapping("/api/v1")
public class LineageController {

    private final ObjectProvider<LineageAssetService> service;

    public LineageController(ObjectProvider<LineageAssetService> service) {
        this.service = service;
    }

    @GetMapping("/assets")
    public Object assets(@RequestParam(required = false) String schema) {
        return requireService().listAssets(schema);
    }

    @GetMapping("/assets/{fullyQualifiedName}")
    public Object asset(@PathVariable String fullyQualifiedName) {
        return requireService().getAsset(fullyQualifiedName);
    }

    @GetMapping("/assets/{fullyQualifiedName}/lineage")
    public Object lineage(@PathVariable String fullyQualifiedName) {
        return requireService().getLineage(fullyQualifiedName);
    }

    @GetMapping("/lineage/summary")
    public Object summary() {
        return requireService().summary();
    }

    private LineageAssetService requireService() {
        var target = service.getIfAvailable();
        if (target == null) {
            throw new AdapterUnavailableException(
                    "血缘服务未配置：请在控制面设置 data-os.openmetadata.base-url 后重启");
        }
        return target;
    }
}
