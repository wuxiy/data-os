package com.cywu.dataos.controlplane.quality;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 资产详情的质量测试面：按 OM 表全限定名给出其归属数据集的质量规则
 * 与最近结论（G7-5）。数据在控制面自有质量域，与血缘面（OM）解耦。
 */
@RestController
@RequestMapping("/api/v1")
public class QualityAssetController {

    private final QualityAssetTestsService service;

    public QualityAssetController(QualityAssetTestsService service) {
        this.service = service;
    }

    @GetMapping("/assets/{fullyQualifiedName}/quality-tests")
    public Map<String, Object> qualityTests(@PathVariable String fullyQualifiedName) {
        List<QualityAssetTestsService.QualityTestView> tests = service.listTests(fullyQualifiedName);
        return Map.of("asset", fullyQualifiedName, "tests", tests);
    }
}
