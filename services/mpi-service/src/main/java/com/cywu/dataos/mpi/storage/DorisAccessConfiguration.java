package com.cywu.dataos.mpi.storage;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Doris 访问层（MySQL 协议）：与主数据源（PG，事务态）分离的批处理态通道。
 * Doris 的 DataSource 由模板内部持有、不注册为容器 bean——容器必须始终
 * 只有 PG 一个 DataSource 候选，否则 Flyway/JdbcTemplate 自动配置会歧义
 * （曾把 Doris 误当迁移目标）。未配置 url 时不装配，服务可独立启动。
 */
@Configuration
@EnableConfigurationProperties(DorisAccessConfiguration.DorisProperties.class)
public class DorisAccessConfiguration {

    @ConfigurationProperties(prefix = "data-os.mpi.doris")
    public static class DorisProperties {
        private String url;
        private String username;
        private String password;
        private String hashSalt;

        public String getUrl() {
            return url;
        }

        public void setUrl(String url) {
            this.url = url;
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }

        public String getPassword() {
            return password;
        }

        public void setPassword(String password) {
            this.password = password;
        }

        public String getHashSalt() {
            return hashSalt;
        }

        public void setHashSalt(String hashSalt) {
            this.hashSalt = hashSalt;
        }
    }

    @Bean(name = "dorisJdbc")
    @ConditionalOnProperty(name = "data-os.mpi.doris.url", matchIfMissing = false)
    JdbcTemplate dorisJdbcTemplate(DorisProperties properties) {
        var dataSource = DataSourceBuilder.create()
                .url(properties.getUrl())
                .username(properties.getUsername())
                .password(properties.getPassword())
                .build();
        var template = new JdbcTemplate(dataSource);
        // 装载是批处理：Blocking 自 JOIN 结果集需要全量拉取。
        template.setMaxRows(0);
        return template;
    }
}
