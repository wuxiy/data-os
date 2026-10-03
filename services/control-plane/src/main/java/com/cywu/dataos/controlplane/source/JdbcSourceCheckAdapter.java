package com.cywu.dataos.controlplane.source;

import com.cywu.dataos.controlplane.api.ErrorMessages;

import java.sql.SQLException;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class JdbcSourceCheckAdapter implements SourceCheckAdapter {

    private final SourceConnections connections;

    @Autowired
    public JdbcSourceCheckAdapter(SourceConnections connections) {
        this.connections = connections;
    }

    public JdbcSourceCheckAdapter() {
        this(SourceConnections.developmentDefaults());
    }

    @Override
    public boolean supports(String protocol) {
        return "JDBC".equalsIgnoreCase(protocol);
    }

    @Override
    public SourceCheckResult check(Source source, Map<String, Object> config) {
        try (var connection = connections.open(source, config)) {
            return connection.isValid(3)
                    ? SourceCheckResult.healthy("JDBC 连接成功")
                    : SourceCheckResult.unhealthy("JDBC 连接未通过有效性检查");
        } catch (SourceConnections.ConnectionConfigurationException exception) {
            return SourceCheckResult.blockedConfiguration(exception.getMessage());
        } catch (SQLException exception) {
            return SourceCheckResult.unhealthy("JDBC 连接失败：" + ErrorMessages.safe(exception));
        }
    }
}
