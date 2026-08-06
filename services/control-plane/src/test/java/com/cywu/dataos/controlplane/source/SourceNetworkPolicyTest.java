package com.cywu.dataos.controlplane.source;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;

import org.junit.jupiter.api.Test;

class SourceNetworkPolicyTest {

    @Test
    void productionPolicyRequiresHttpsAndAllowlistedPublicHost() {
        var properties = new SourceNetworkProperties();
        properties.setAllowedHosts(List.of("example.com"));
        var policy = new SourceNetworkPolicy(properties);

        assertThrows(IllegalArgumentException.class,
                () -> policy.validateHttpUrl("http://example.com/health"));
        assertThrows(IllegalArgumentException.class,
                () -> policy.validateHttpUrl("https://169.254.169.254/latest/meta-data"));
        assertThrows(IllegalArgumentException.class,
                () -> policy.validateHttpUrl("https://not-allowed.example.net/health"));
    }

    @Test
    void productionPolicyRejectsLoopbackAndPrivateJdbcTargets() {
        var properties = new SourceNetworkProperties();
        properties.setAllowedHosts(List.of("127.0.0.1", "db.example.com"));
        var policy = new SourceNetworkPolicy(properties);

        assertThrows(IllegalArgumentException.class,
                () -> policy.validateHttpUrl("https://127.0.0.1/health"));
        assertThrows(IllegalArgumentException.class,
                () -> policy.validateJdbcUrl("jdbc:postgresql://127.0.0.1:5432/data_os"));
    }

    @Test
    void developmentPolicyExplicitlyAllowsTestProtocol() {
        var properties = new SourceNetworkProperties();
        properties.setAllowPrivateNetworks(true);
        properties.setAllowTestProtocols(true);
        var policy = new SourceNetworkPolicy(properties);

        assertDoesNotThrow(() -> policy.validateJdbcUrl("jdbc:h2:mem:data_os"));
    }
}
