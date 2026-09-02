package com.cywu.dataos.controlplane.quality;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Service;

/**
 * 资产视角的质量测试读模型：按表全限定名解析其归属数据集（逻辑
 * dataset_id 经配置映射，库.表 形态直接匹配），聚合规则注册表与最近
 * 一次运行结果。数据源是控制面自有质量域（registry/runs 两表），不经
 * OpenMetadata——质量规则的一等资产在 control-plane，元数据侧同步
 * （OM TestCase）另案（G7 偏差记录）。
 */
@Service
public class QualityAssetTestsService {

    private final QualityRunRepository runs;
    private final QualityAssetProperties properties;

    public QualityAssetTestsService(QualityRunRepository runs, QualityAssetProperties properties) {
        this.runs = runs;
        this.properties = properties;
    }

    /** 表全限定名（服务.default.库.表）下的质量测试与最近结果。 */
    public List<QualityTestView> listTests(String fullyQualifiedName) {
        var datasets = datasetsFor(fullyQualifiedName);
        if (datasets.isEmpty()) {
            return List.of();
        }
        var views = new ArrayList<QualityTestView>();
        var seen = new HashSet<String>();
        for (String dataset : datasets) {
            for (var rule : runs.findEnabledRules(dataset)) {
                if (!seen.add(rule.ruleId())) {
                    continue;
                }
                views.add(new QualityTestView(
                        rule.ruleId(),
                        rule.datasetId(),
                        rule.selector(),
                        runs.findLastTerminalRun(rule.ruleId()).orElse(null)));
            }
        }
        return List.copyOf(views);
    }

    /** 解析表归属的 dataset_id：库.表 直接段匹配 + 逻辑资产经配置映射。 */
    private Set<String> datasetsFor(String fullyQualifiedName) {
        var datasets = new HashSet<String>();
        var parts = fullyQualifiedName.split("\\.");
        if (parts.length >= 4) {
            datasets.add(parts[parts.length - 2] + "." + parts[parts.length - 1]);
        }
        for (var entry : properties.getDatasetTables().entrySet()) {
            if (entry.getValue().contains(fullyQualifiedName)) {
                datasets.add(entry.getKey());
            }
        }
        return datasets;
    }

    /** 单条质量测试（规则注册表口径；最近结论复用仓储的读模型）。 */
    public record QualityTestView(
            String ruleId, String datasetId, String selector,
            QualityRunRepository.QualityRuleLastRun lastRun) {
    }
}
