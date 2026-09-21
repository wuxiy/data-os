package com.cywu.dataos.controlplane.operations;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 运营只读投影（G24）：管理驾驶舱与运营中心的统一事实源。不新建状态表、
 * 不拥有任何生命周期——全部读既有域事实并带 sourceType/sourceId/asOf 与深链。
 * 权限：GET 四角色（管理员/治理/工程师；面向治理负责人与技术运维）。
 */
@RestController
@RequestMapping("/api/v1/operations")
public class OperationsProjectionController {

    private final OperationsProjectionService service;

    public OperationsProjectionController(OperationsProjectionService service) {
        this.service = service;
    }

    @GetMapping("/summary")
    public Map<String, Object> summary(@RequestParam(required = false) String tenantId) {
        return service.summary(tenantId);
    }

    @GetMapping("/work-items")
    public Map<String, Object> workItems(@RequestParam(required = false) String type,
                                         @RequestParam(defaultValue = "50") int limit,
                                         @RequestParam(required = false) String tenantId) {
        return service.workItems(tenantId, type, limit);
    }

    @GetMapping("/events")
    public Map<String, Object> events(@RequestParam(defaultValue = "30") int limit,
                                      @RequestParam(required = false) String tenantId) {
        return service.events(tenantId, limit);
    }
}
