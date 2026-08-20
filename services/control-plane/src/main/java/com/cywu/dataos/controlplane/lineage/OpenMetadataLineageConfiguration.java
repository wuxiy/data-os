package com.cywu.dataos.controlplane.lineage;

import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 血缘链装配：仅在显式配置 data-os.openmetadata.base-url 时注册服务 bean。
 * 与 MPI 的 Doris 访问链同款条件装配纪律（yml 不给默认值，空串不视为已配置）。
 */
@Configuration
@EnableConfigurationProperties(OpenMetadataLineageProperties.class)
public class OpenMetadataLineageConfiguration {

    @Bean
    @ConditionalOnExpression("!'${data-os.openmetadata.base-url:}'.isBlank()")
    public OpenMetadataClient openMetadataClient(OpenMetadataLineageProperties properties,
                                                 RestClient.Builder builder) {
        return new OpenMetadataClient(builder, properties);
    }

    @Bean
    @ConditionalOnExpression("!'${data-os.openmetadata.base-url:}'.isBlank()")
    public LineageAssetService lineageAssetService(OpenMetadataClient client,
                                                   OpenMetadataLineageProperties properties) {
        return new LineageAssetService(client, properties);
    }
}
