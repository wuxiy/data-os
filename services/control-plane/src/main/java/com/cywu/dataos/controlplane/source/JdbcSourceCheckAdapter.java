package com.cywu.dataos.controlplane.source;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.Properties;

import org.springframework.stereotype.Component;

@Component
public class JdbcSourceCheckAdapter implements SourceCheckAdapter {

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

        var properties = new Properties();
        putIfPresent(properties, "user", config.get("username"));
        putIfPresent(properties, "password", config.get("password"));
        try (var connection = DriverManager.getConnection(jdbcUrl, properties)) {
            return connection.isValid(3)
                    ? SourceCheckResult.healthy("JDBC 连接成功")
                    : SourceCheckResult.unhealthy("JDBC 连接未通过有效性检查");
        } catch (SQLException exception) {
            return SourceCheckResult.unhealthy("JDBC 连接失败：" + safeMessage(exception));
        }
    }

    private void putIfPresent(Properties properties, String key, Object value) {
        var text = stringValue(value);
        if (!text.isBlank()) properties.setProperty(key, text);
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    private String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) return "未知错误";
        var sanitized = message.replaceAll("(?i)(password|passwd)=[^&; ]+", "$1=***");
        return sanitized.substring(0, Math.min(sanitized.length(), 240));
    }
}
