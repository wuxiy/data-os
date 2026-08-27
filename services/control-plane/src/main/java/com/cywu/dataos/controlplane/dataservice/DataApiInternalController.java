package com.cywu.dataos.controlplane.dataservice;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 执行面内部端点（G13 方案 §五）：data-api 服务的 registry 拉取与审计回写。
 * 认证由 {@code OidcSecurityConfiguration} 的 {@code /internal/data-api/**}
 * authenticated() 规则承担——仅接受 audience=data-os 的服务 token
 * （Keycloak client dataos-data-api + audience mapper）。
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
                report.idempotencyKey());
        return Map.of("accepted", accepted);
    }

    public record CallReport(String code, String keyHash, String parametersJson, int rowCount,
                             boolean truncated, int elapsedMs, int statusCode, String idempotencyKey) {
    }
}
