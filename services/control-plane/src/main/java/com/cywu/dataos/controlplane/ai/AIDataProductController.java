package com.cywu.dataos.controlplane.ai;

import java.net.URI;
import java.util.List;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * AI Data Product API（G8 计划 §三）。鉴权/租户/审计与既有面一致：
 * OIDC 保护 {@code /api/**}，审计由 AuditInterceptor 入库。
 */
@RestController
@RequestMapping("/api/v1/ai-data-products")
public class AIDataProductController {

    private final AIDataProductService service;

    public AIDataProductController(AIDataProductService service) {
        this.service = service;
    }

    @GetMapping
    public AIDataProductListResponse list(@RequestParam(required = false) String tenantId) {
        var items = service.list(tenantId);
        return new AIDataProductListResponse(items, items.size());
    }

    @PostMapping
    public ResponseEntity<AIDataProduct> create(@Valid @RequestBody CreateAIDataProductRequest request) {
        var product = service.create(request);
        return ResponseEntity
                .created(URI.create("/api/v1/ai-data-products/" + product.id()))
                .body(product);
    }

    @GetMapping("/{id}")
    public AIDataProductService.AIDataProductDetail detail(@PathVariable String id) {
        return service.detail(id);
    }

    @PostMapping("/{id}/lifecycle")
    public AIDataProduct transition(@PathVariable String id, @RequestBody LifecycleTransitionRequest request) {
        return service.transition(id, request.target());
    }

    @PostMapping("/{id}/build")
    public Object build(@PathVariable String id, @RequestBody(required = false) BuildRequest request) {
        // 引擎未装配时此处不会到达（Service 抛 EngineNotConfiguredException -> 503）。
        var runId = service.build(id, request == null ? null : request.recipeRef());
        return java.util.Map.of("runId", runId);
    }

    public record AIDataProductListResponse(List<AIDataProduct> items, int total) {
    }

    public record LifecycleTransitionRequest(String target) {
    }

    public record BuildRequest(String recipeRef) {
    }
}
