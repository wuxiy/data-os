package com.cywu.dataos.controlplane.workflow;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Product-facing catalog used by the ingestion page and implementation team. */
@RestController
@RequestMapping("/api/v1/workflow-templates")
public class ClinicalWorkflowController {

    private final ClinicalWorkflowCatalog catalog;

    public ClinicalWorkflowController(ClinicalWorkflowCatalog catalog) {
        this.catalog = catalog;
    }

    @GetMapping
    public List<ClinicalWorkflowTemplate> list() {
        return catalog.list();
    }
}
