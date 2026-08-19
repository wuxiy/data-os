package com.cywu.dataos.mpi.person;

import java.util.Map;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.cywu.dataos.mpi.review.MpiReviewQueryService;
import com.cywu.dataos.mpi.security.TenantScope;

/**
 * 黄金人操作 API（G3 方案清单）：
 * GET  /persons/{id}          详情（属性/身份链接/操作历史）
 * POST /persons/merge         人工合并（keep 吸收 drop）
 * POST /persons/{id}/split    把一个身份从黄金人拆出为独立人（H-ep2 生效）
 * 操作链随 Doris 访问层条件化：未配置时 503。
 */
@RestController
@RequestMapping("/api/v1/mpi")
public class MpiPersonController {

    private final TenantScope tenantScope;
    private final ObjectProvider<MpiPersonService> persons;
    private final ObjectProvider<MpiReviewQueryService> queries;

    public MpiPersonController(TenantScope tenantScope, ObjectProvider<MpiPersonService> persons,
                               ObjectProvider<MpiReviewQueryService> queries) {
        this.tenantScope = tenantScope;
        this.persons = persons;
        this.queries = queries;
    }

    @GetMapping("/persons/{id}")
    public ResponseEntity<Map<String, Object>> person(@PathVariable String id) {
        var query = queries.getIfAvailable();
        if (query == null) throw unavailable();
        return ResponseEntity.ok(query.person(tenantScope.current().tenantId(), id));
    }

    @PostMapping("/persons/merge")
    public ResponseEntity<Map<String, Object>> merge(@RequestBody Map<String, String> body) {
        var service = persons.getIfAvailable();
        if (service == null) throw unavailable();
        var keep = required(body, "keepPersonId");
        var drop = required(body, "dropPersonId");
        var scope = tenantScope.current();
        service.mergePersons(scope.tenantId(), scope.institutionId(), keep, drop,
                "MANUAL", scope.subject(), body.get("reason"));
        return ResponseEntity.ok(Map.of("keepPersonId", keep, "mergedPersonId", drop));
    }

    @PostMapping("/persons/{id}/split")
    public ResponseEntity<Map<String, Object>> split(@PathVariable String id,
                                                     @RequestBody Map<String, String> body) {
        var service = persons.getIfAvailable();
        if (service == null) throw unavailable();
        var identityGroup = required(body, "identityGroup");
        var scope = tenantScope.current();
        var newPersonId = service.splitIdentity(scope.tenantId(), scope.institutionId(), id,
                identityGroup, scope.subject(), body.get("reason"));
        return ResponseEntity.ok(Map.of("personId", id, "newPersonId", newPersonId,
                "splitIdentity", identityGroup));
    }

    private static String required(Map<String, String> body, String key) {
        var value = body == null ? null : body.get(key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(key + " 不能为空");
        }
        return value.trim();
    }

    private static ResponseStatusException unavailable() {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Doris 批处理通道未配置");
    }
}
