package com.cywu.dataos.mpi.storage;

import javax.sql.DataSource;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Doris 访问层（MySQL 协议）：与主数据源（PG，事务态）分离的批处理态通道。
 * 未配置 url 时不装配——服务可独立于 Doris 启动，rebuild 显式报 503。
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

    @Bean(name = "dorisDataSource")
    @ConditionalOnProperty(name = "data-os.mpi.doris.url", matchIfMissing = false)
    DataSource dorisDataSource(DorisProperties properties) {
        return DataSourceBuilder.create()
                .url(properties.getUrl())
                .username(properties.getUsername())
                .password(properties.getPassword())
                .build();
    }

    @Bean(name = "dorisJdbc")
    @ConditionalOnProperty(name = "data-os.mpi.doris.url", matchIfMissing = false)
    JdbcTemplate dorisJdbcTemplate(DataSource dorisDataSource) {
        var template = new JdbcTemplate(dorisDataSource);
        // 装载是批处理：放宽单语句行数限制（Blocking 自 JOIN 结果集全量拉取）。
        template.setMaxRows(0);
        return template;
    }
}
