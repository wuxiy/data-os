package com.cywu.dataos.mpi.review;

import java.util.Map;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import com.cywu.dataos.mpi.security.TenantScope;

/**
 * 复核工作台 API（G3 方案清单）：
 * GET  /candidates?status=REVIEW 分页任务列表（双侧身份对比+证据）
 * GET  /matches/{pairId}/explain 命中规则与逐字段证据
 * POST /links/{taskId}/decision 人工决策（同人并人 / 不同人终态否决）
 */
@RestController
@RequestMapping("/api/v1/mpi")
public class MpiReviewController {

    private final TenantScope tenantScope;
    private final ObjectProvider<MpiReviewQueryService> queries;
    private final ObjectProvider<MpiReviewService> decisions;

    public MpiReviewController(TenantScope tenantScope,
                               ObjectProvider<MpiReviewQueryService> queries,
                               ObjectProvider<MpiReviewService> decisions) {
        this.tenantScope = tenantScope;
        this.queries = queries;
        this.decisions = decisions;
    }

    @GetMapping("/candidates")
    public ResponseEntity<Map<String, Object>> candidates(
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "page", defaultValue = "1") int page,
            @RequestParam(name = "size", defaultValue = "20") int size) {
        var query = queries.getIfAvailable();
        if (query == null) throw unavailable();
        var scope = tenantScope.current();
        return ResponseEntity.ok(query.candidates(scope.tenantId(), status,
                Math.max(1, page), Math.min(Math.max(1, size), 100)));
    }

    @GetMapping("/matches/{pairId}/explain")
    public ResponseEntity<Map<String, Object>> explain(@PathVariable long pairId) {
        var query = queries.getIfAvailable();
        if (query == null) throw unavailable();
        return ResponseEntity.ok(query.explain(tenantScope.current().tenantId(), pairId));
    }

    @PostMapping("/links/{taskId}/decision")
    public ResponseEntity<Map<String, Object>> decide(@PathVariable String taskId,
                                                      @RequestBody Map<String, String> body) {
        var service = decisions.getIfAvailable();
        if (service == null) throw unavailable();
        var scope = tenantScope.current();
        return ResponseEntity.ok(service.resolve(scope.tenantId(), scope.institutionId(), taskId,
                body.get("resolution"), body.get("reason"), scope.subject()));
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Doris 批处理通道未配置");
    }
}
