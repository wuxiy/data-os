package com.cywu.dataos.controlplane.source;

import java.net.URI;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/sources")
public class SourceController {

    private final SourceService service;
    private final SourceExplorerService explorer;

    public SourceController(SourceService service, SourceExplorerService explorer) {
        this.service = service;
        this.explorer = explorer;
    }

    @GetMapping
    public SourceListResponse list(
            @RequestParam(required = false) String tenantId,
            @RequestParam(required = false) String institutionId) {
        var items = service.list(tenantId, institutionId);
        return new SourceListResponse(items, items.size());
    }

    @PostMapping
    public ResponseEntity<Source> create(@Valid @RequestBody CreateSourceRequest request) {
        var source = service.create(request);
        return ResponseEntity.created(URI.create("/api/v1/sources/" + source.id())).body(source);
    }

    @PostMapping("/{sourceId}/check")
    public Source check(@PathVariable String sourceId,
                        @RequestBody(required = false) SourceCheckRequest request) {
        return service.check(sourceId, request);
    }

    /** 登记非敏感连接配置（浏览与查询的工作连接来源）；明文凭据一律拒绝。 */
    @PutMapping("/{sourceId}/connection")
    public Source saveConnection(@PathVariable String sourceId,
                                 @RequestBody(required = false) SourceConnectionRequest request) {
        return service.saveConnection(sourceId, request);
    }

    @GetMapping("/{sourceId}/catalogs")
    public SourceExplorerService.CatalogListResponse catalogs(@PathVariable String sourceId) {
        return explorer.catalogs(sourceId);
    }

    @GetMapping("/{sourceId}/tables")
    public SourceExplorerService.TableListResponse tables(@PathVariable String sourceId,
                                                          @RequestParam(required = false) String catalog) {
        return explorer.tables(sourceId, catalog);
    }

    @GetMapping("/{sourceId}/columns")
    public SourceExplorerService.ColumnListResponse columns(@PathVariable String sourceId,
                                                            @RequestParam(required = false) String catalog,
                                                            @RequestParam String table) {
        return explorer.columns(sourceId, catalog, table);
    }

    @PostMapping("/{sourceId}/query")
    public SourceExplorerService.QueryResultResponse query(@PathVariable String sourceId,
                                                           @RequestBody SourceQueryRequest request) {
        return explorer.query(sourceId, request);
    }

    public record SourceListResponse(java.util.List<Source> items, int total) {
    }
}
