package com.cywu.dataos.controlplane.platform;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/platform-operations")
public class PlatformOperationsController {

    private final PlatformOperationsService service;

    public PlatformOperationsController(PlatformOperationsService service) {
        this.service = service;
    }

    @GetMapping
    public PlatformOperationsService.PlatformOperationsStatus status() {
        return service.snapshot();
    }
}
