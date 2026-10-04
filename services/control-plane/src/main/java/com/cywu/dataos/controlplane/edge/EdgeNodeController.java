package com.cywu.dataos.controlplane.edge;

import java.util.List;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 前置机节点管理面（G2G 批次 4）：台账 CRUD + 中心 TCP 探活。 */
@RestController
@RequestMapping("/api/v1/edge/nodes")
public class EdgeNodeController {

    private final EdgeNodeService service;
    private final EdgeWatermarkClient watermarkClient;

    public EdgeNodeController(EdgeNodeService service, EdgeWatermarkClient watermarkClient) {
        this.service = service;
        this.watermarkClient = watermarkClient;
    }

    @GetMapping
    public EdgeNodeListResponse list() {
        var items = service.list();
        return new EdgeNodeListResponse(items, items.size());
    }

    /** 登记（无 id）或更新（带 id）。 */
    @PutMapping({ "", "/{nodeId}" })
    public ResponseEntity<EdgeNode> save(@PathVariable(required = false) String nodeId,
                                         @Valid @RequestBody SaveEdgeNodeRequest request) {
        var created = nodeId == null || nodeId.isBlank();
        var node = service.save(created ? null : nodeId, request);
        return created
                ? ResponseEntity.created(java.net.URI.create("/api/v1/edge/nodes/" + node.id())).body(node)
                : ResponseEntity.ok(node);
    }

    /** 同步探测：TCP 连接目标 host:port，结果回写为最近一次探测。 */
    @PostMapping("/{nodeId}/probe")
    public EdgeNode probe(@PathVariable String nodeId) {
        return service.probe(nodeId);
    }

    @DeleteMapping("/{nodeId}")
    public ResponseEntity<Void> delete(@PathVariable String nodeId) {
        service.delete(nodeId);
        return ResponseEntity.noContent().build();
    }

    /** 发布记录（nema nodeDeploy 降格为登记面）。 */
    @GetMapping("/{nodeId}/deployments")
    public java.util.List<EdgeDeployment> deployments(@PathVariable String nodeId) {
        return service.deployments(nodeId);
    }

    @PostMapping("/{nodeId}/deployments")
    public ResponseEntity<java.util.List<EdgeDeployment>> recordDeployment(
            @PathVariable String nodeId,
            @Valid @RequestBody RecordEdgeDeploymentRequest request) {
        var deployments = service.recordDeployment(nodeId, request);
        return ResponseEntity.ok(deployments);
    }

    /** 采集水位：代理质量执行器的白名单聚合只读端点（边缘表）。 */
    @GetMapping("/watermarks")
    public java.util.Map<String, Object> watermarks() {
        return watermarkClient.watermarks();
    }

    public record EdgeNodeListResponse(List<EdgeNode> items, int total) {
    }
}
