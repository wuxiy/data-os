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

    @Test
    void developmentPolicyAllowsDamengJdbcTarget() {
        var properties = new SourceNetworkProperties();
        properties.setAllowPrivateNetworks(true);
        properties.setAllowTestProtocols(true);
        var policy = new SourceNetworkPolicy(properties);

        assertDoesNotThrow(() -> policy.validateJdbcUrl("jdbc:dm://192.168.17.76:5236?schema=EP_TEST"));
        assertDoesNotThrow(() -> policy.validateJdbcUrl("jdbc:dm://192.168.17.76:5236/EP"));
    }

    @Test
    void productionPolicyAppliesAllowlistToDamengTargets() {
        var properties = new SourceNetworkProperties();
        properties.setAllowPrivateNetworks(true);
        properties.setAllowedHosts(List.of("192.168.17.0/24"));
        var policy = new SourceNetworkPolicy(properties);

        assertDoesNotThrow(() -> policy.validateJdbcUrl("jdbc:dm://192.168.17.76:5236?schema=EP_TEST"));
        assertThrows(IllegalArgumentException.class,
                () -> policy.validateJdbcUrl("jdbc:dm://192.168.18.76:5236?schema=EP_TEST"));
        assertThrows(IllegalArgumentException.class,
                () -> policy.validateJdbcUrl("jdbc:db2://192.168.17.76:50000/SAMPLE"));
    }

    @Test
    void productionPrivateTargetRequiresExplicitCidrAllowlist() {
        var properties = new SourceNetworkProperties();
        properties.setAllowPrivateNetworks(true);
        properties.setAllowedHosts(List.of("10.42.0.0/16"));
        var policy = new SourceNetworkPolicy(properties);

        assertDoesNotThrow(() -> policy.validateJdbcUrl("jdbc:postgresql://10.42.3.7:5432/lis"));
        assertThrows(IllegalArgumentException.class,
                () -> policy.validateJdbcUrl("jdbc:postgresql://10.43.3.7:5432/lis"));
    }

    @Test
    void privateNetworkAllowlistDoesNotEnableDevelopmentCredentialFallback() {
        var properties = new SourceNetworkProperties();
        properties.setAllowPrivateNetworks(true);
        properties.setAllowedHosts(List.of("10.42.0.0/16"));
        var policy = new SourceNetworkPolicy(properties);

        org.junit.jupiter.api.Assertions.assertFalse(policy.isLocalMode());

        properties.setAllowTestProtocols(true);
        org.junit.jupiter.api.Assertions.assertFalse(policy.isLocalMode());
    }
}
