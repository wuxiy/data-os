package com.cywu.dataos.controlplane.quality;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

/**
 * 质量测试资产面装配（G7-5）：数据集映射配置注册。
 */
@Configuration
@EnableConfigurationProperties(QualityAssetProperties.class)
public class QualityAssetConfiguration {
}
