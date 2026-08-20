package com.cywu.dataos.controlplane.analytics;

import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 嵌入式分析链装配：仅在显式配置 data-os.analytics.superset.base-url 时注册
 * 服务 bean（空串不视为已配置，与血缘链同款条件装配纪律）。
 */
@Configuration
@EnableConfigurationProperties(AnalyticsProperties.class)
public class AnalyticsConfiguration {

    @Bean
    @ConditionalOnExpression("!'${data-os.analytics.superset.base-url:}'.isBlank()")
    public SupersetGuestTokenService supersetGuestTokenService(AnalyticsProperties properties,
                                                               RestClient.Builder builder) {
        return new SupersetGuestTokenService(builder, properties);
    }
}
