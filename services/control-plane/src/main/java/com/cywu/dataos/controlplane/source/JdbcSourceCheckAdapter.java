package com.cywu.dataos.controlplane.source;

import com.cywu.dataos.controlplane.api.ErrorMessages;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.Properties;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.cywu.dataos.controlplane.credential.CredentialResolver;

@Component
public class JdbcSourceCheckAdapter implements SourceCheckAdapter {

    private final SourceNetworkPolicy networkPolicy;
    private final CredentialResolver credentialResolver;

    @Autowired
    public JdbcSourceCheckAdapter(SourceNetworkPolicy networkPolicy, CredentialResolver credentialResolver) {
        this.networkPolicy = networkPolicy;
        this.credentialResolver = credentialResolver;
    }

    public JdbcSourceCheckAdapter() {
        this(SourceNetworkPolicy.developmentDefaults(), (reference, tenant, institution) -> Map.of());
    }

    @Override
    public boolean supports(String protocol) {
        return "JDBC".equalsIgnoreCase(protocol);
    }

    @Override
    public SourceCheckResult check(Source source, Map<String, Object> config) {
        var jdbcUrl = stringValue(config.get("jdbcUrl"));
        if (jdbcUrl.isBlank()) {
            return SourceCheckResult.blockedConfiguration("JDBC 检查需要 jdbcUrl");
        }
        try {
            networkPolicy.validateJdbcUrl(jdbcUrl);
        } catch (IllegalArgumentException exception) {
            return SourceCheckResult.blockedConfiguration(exception.getMessage());
        }

        var properties = new Properties();
        var credentialRef = stringValue(config.get("credentialRef"));
        if (!credentialRef.isBlank()) {
            try {
                var credentials = credentialResolver.resolve(credentialRef, source.tenantId(), source.institutionId());
                putIfPresent(properties, "user", credentials.get("username"));
                putIfPresent(properties, "password", credentials.get("password"));
            } catch (RuntimeException exception) {
                return SourceCheckResult.blockedConfiguration("凭据引用无法解析");
            }
        } else if (!networkPolicy.isLocalMode()
                && (config.containsKey("password") || config.containsKey("secret") || config.containsKey("token"))) {
            return SourceCheckResult.blockedConfiguration("生产数据源检查必须使用 credentialRef，不能提交明文凭据");
        } else {
            putIfPresent(properties, "user", config.get("username"));
            putIfPresent(properties, "password", config.get("password"));
        }
        try (var connection = DriverManager.getConnection(jdbcUrl, properties)) {
            return connection.isValid(3)
                    ? SourceCheckResult.healthy("JDBC 连接成功")
                    : SourceCheckResult.unhealthy("JDBC 连接未通过有效性检查");
        } catch (SQLException exception) {
            return SourceCheckResult.unhealthy("JDBC 连接失败：" + ErrorMessages.safe(exception));
        }
    }

    private void putIfPresent(Properties properties, String key, Object value) {
        var text = stringValue(value);
        if (!text.isBlank()) properties.setProperty(key, text);
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
