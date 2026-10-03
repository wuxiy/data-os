package com.cywu.dataos.controlplane.source;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.Properties;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.cywu.dataos.controlplane.credential.CredentialResolver;

/**
 * 数据源连接组装的共享件：SSRF 校验、凭据解析与连接属性组装。
 * 可用性检查、连接登记、目录浏览与受控查询四条链路共用同一套规则，
 * 行为与既有检查适配器完全一致。
 */
@Component
public class SourceConnections {

    /** 连接配置不满足完整性或安全前置条件（检查链路对应 BLOCKED_CONFIGURATION）。 */
    public static class ConnectionConfigurationException extends RuntimeException {

        public ConnectionConfigurationException(String message) {
            super(message);
        }
    }

    private final SourceNetworkPolicy networkPolicy;
    private final CredentialResolver credentialResolver;

    @Autowired
    public SourceConnections(SourceNetworkPolicy networkPolicy, CredentialResolver credentialResolver) {
        this.networkPolicy = networkPolicy;
        this.credentialResolver = credentialResolver;
    }

    public static SourceConnections developmentDefaults() {
        return new SourceConnections(SourceNetworkPolicy.developmentDefaults(),
                (reference, tenant, institution) -> Map.of());
    }

    /** 校验 JDBC URL 的网络可达范围（SSRF 防护），非法时抛 IllegalArgumentException。 */
    public void validateJdbcUrl(String jdbcUrl) {
        networkPolicy.validateJdbcUrl(jdbcUrl);
    }

    /** 解析凭据引用；引用不存在或不可用时抛 RuntimeException。 */
    public Map<String, Object> resolveCredential(String reference, String tenantId, String institutionId) {
        return credentialResolver.resolve(reference, tenantId, institutionId);
    }

    /** 打开一条工作连接，调用方负责关闭；配置不合法时抛 {@link ConnectionConfigurationException}。 */
    public Connection open(Source source, Map<String, Object> config) throws SQLException {
        var jdbcUrl = stringValue(config.get("jdbcUrl"));
        if (jdbcUrl.isBlank()) {
            throw new ConnectionConfigurationException("JDBC 检查需要 jdbcUrl");
        }
        try {
            networkPolicy.validateJdbcUrl(jdbcUrl);
        } catch (IllegalArgumentException exception) {
            throw new ConnectionConfigurationException(exception.getMessage());
        }

        var properties = new Properties();
        var credentialRef = stringValue(config.get("credentialRef"));
        if (!credentialRef.isBlank()) {
            try {
                var credentials = credentialResolver.resolve(credentialRef, source.tenantId(), source.institutionId());
                putIfPresent(properties, "user", credentials.get("username"));
                putIfPresent(properties, "password", credentials.get("password"));
            } catch (RuntimeException exception) {
                throw new ConnectionConfigurationException("凭据引用无法解析");
            }
        } else if (!networkPolicy.isLocalMode()
                && (config.containsKey("password") || config.containsKey("secret") || config.containsKey("token"))) {
            throw new ConnectionConfigurationException("生产数据源检查必须使用 credentialRef，不能提交明文凭据");
        } else {
            putIfPresent(properties, "user", config.get("username"));
            putIfPresent(properties, "password", config.get("password"));
        }
        return DriverManager.getConnection(jdbcUrl, properties);
    }

    private void putIfPresent(Properties properties, String key, Object value) {
        var text = stringValue(value);
        if (!text.isBlank()) properties.setProperty(key, text);
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
