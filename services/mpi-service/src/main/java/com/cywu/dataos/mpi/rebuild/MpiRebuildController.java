package com.cywu.dataos.mpi.rebuild;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.cywu.dataos.mpi.security.TenantScope;

/**
 * POST /api/v1/mpi/rebuild：按当前租户触发装载+候选召回（幂等，覆盖写）。
 * Doris 未配置（访问层未装配）时显式 503——服务存活但批处理通道不可用。
 */
@RestController
@RequestMapping("/api/v1/mpi")
public class MpiRebuildController {

    private final TenantScope tenantScope;
    private final ObjectProvider<MpiRebuildService> rebuildService;

    public MpiRebuildController(TenantScope tenantScope, ObjectProvider<MpiRebuildService> rebuildService) {
        this.tenantScope = tenantScope;
        this.rebuildService = rebuildService;
    }

    @PostMapping("/rebuild")
    public ResponseEntity<Map<String, Object>> rebuild() {
        var service = rebuildService.getIfAvailable();
        if (service == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Doris 批处理通道未配置");
        }
        var scope = tenantScope.current();
        var result = service.rebuild(scope.tenantId(), scope.institutionId(), scope.subject());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("identitiesLoaded", result.identitiesLoaded());
        body.put("identitiesSkipped", result.identitiesSkipped());
        body.put("candidatePairs", result.candidatePairs());
        Map<String, Integer> blocking = new LinkedHashMap<>();
        blocking.put("B3", result.blockingB3());
        blocking.put("B4", result.blockingB4());
        blocking.put("B6", result.blockingB6());
        body.put("blocking", blocking);
        Map<String, Integer> outcomes = new LinkedHashMap<>();
        outcomes.put("autoMatch", result.autoMatches());
        outcomes.put("review", result.reviewPairs());
        outcomes.put("noMatch", result.noMatchPairs());
        outcomes.put("hardConflict", result.hardConflicts());
        body.put("outcomes", outcomes);
        return ResponseEntity.ok(body);
    }
}
