package com.cywu.dataos.controlplane.quality;

import java.util.List;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 质量测试资产面配置：逻辑数据集（rules.yml 的 dataset_id，如
 * asset-ep-prescription-edge）到 OM 表全限定名的映射。库.表 形态的
 * dataset_id 无需配置（直接按段匹配）。
 */
@ConfigurationProperties(prefix = "data-os.quality")
public class QualityAssetProperties {

    /** 逻辑 dataset_id -> 表全限定名清单（服务.default.库.表）。 */
    private Map<String, List<String>> datasetTables = Map.of();

    public Map<String, List<String>> getDatasetTables() {
        return datasetTables;
    }

    public void setDatasetTables(Map<String, List<String>> datasetTables) {
        this.datasetTables = datasetTables == null ? Map.of() : datasetTables;
    }
}
