package com.cywu.dataos.controlplane.source;

import java.net.URI;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/sources")
public class SourceController {

    private final SourceService service;

    public SourceController(SourceService service) {
        this.service = service;
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

    public record SourceListResponse(java.util.List<Source> items, int total) {
    }
}
