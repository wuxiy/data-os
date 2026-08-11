package com.cywu.dataos.controlplane.system;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;
import com.cywu.dataos.controlplane.credential.CredentialProperties;
import com.cywu.dataos.controlplane.security.AuthProperties;
import com.cywu.dataos.controlplane.source.SourceNetworkProperties;

class RuntimeConfigurationValidatorTest {

    @Test
    void productionRejectsDemoSeed() {
        var validator = new RuntimeConfigurationValidator("production", true, "HTTP", false);

        assertThrows(IllegalStateException.class, validator::validate);
    }

    @Test
    void productionRejectsDemoExecutorEvenWhenSeedIsOff() {
        var validator = new RuntimeConfigurationValidator("production", false, "DEMO", true);

        assertThrows(IllegalStateException.class, validator::validate);
    }

    @Test
    void productionNormalizationDoesNotAllowWhitespaceBypass() {
        var validator = new RuntimeConfigurationValidator(" production ", false, " DEMO ", true);

        assertThrows(IllegalStateException.class, validator::validate);
    }

    @Test
    void developmentMayUseDemoExecutor() {
        var validator = new RuntimeConfigurationValidator("development", true, "DEMO", true);

        assertDoesNotThrow(validator::validate);
    }

    @Test
    void unknownEnvironmentFailsClosed() {
        var validator = new RuntimeConfigurationValidator("staging", false, "HTTP", false);

        assertThrows(IllegalStateException.class, validator::validate);
    }

    @Test
    void productionAcceptsOnlyExplicitlyHardenedConfiguration() {
        var auth = new AuthProperties();
        auth.setMode("enforced");
        auth.setIssuerUri("https://id.example.test/realms/data-os");
        auth.setAudience("data-os");
        auth.setDefaultTenantId("hospital_a");
        auth.setDefaultInstitutionId("hospital_a_main");
        auth.setAllowDefaultScope(false);
        var credentials = new CredentialProperties();
        credentials.setEncryptionKey(java.util.Base64.getEncoder().encodeToString(new byte[32]));
        var network = new SourceNetworkProperties();
        network.setAllowedHosts(java.util.List.of("source.example.test"));

        var validator = new RuntimeConfigurationValidator("production", false, "HTTP", false,
                "hospital_a_platform", auth, credentials, network);

        assertDoesNotThrow(validator::validate);
    }

    @Test
    void productionRejectsMissingAudienceOrUnsafeResponseLimit() {
        var auth = new AuthProperties();
        auth.setMode("ENFORCED");
        auth.setIssuerUri("https://id.example.test/realms/data-os");
        auth.setAudience(" ");
        auth.setDefaultTenantId("hospital_a");
        auth.setDefaultInstitutionId("hospital_a_main");
        auth.setAllowDefaultScope(false);
        var credentials = new CredentialProperties();
        credentials.setEncryptionKey(java.util.Base64.getEncoder().encodeToString(new byte[32]));
        var network = new SourceNetworkProperties();
        network.setAllowedHosts(java.util.List.of("source.example.test"));
        network.setMaxResponseBytes(2);

        var validator = new RuntimeConfigurationValidator("production", false, "HTTP", false,
                "hospital_a_platform", auth, credentials, network);

        assertThrows(IllegalStateException.class, validator::validate);
    }

    @Test
    void productionRejectsDefaultTenantFallback() {
        var auth = new AuthProperties();
        auth.setMode("ENFORCED");
        auth.setIssuerUri("https://id.example.test/realms/data-os");
        auth.setAudience("data-os");
        auth.setAllowDefaultScope(false);
        var credentials = new CredentialProperties();
        credentials.setEncryptionKey(java.util.Base64.getEncoder().encodeToString(new byte[32]));
        var network = new SourceNetworkProperties();
        network.setAllowedHosts(java.util.List.of("source.example.test"));

        var validator = new RuntimeConfigurationValidator("production", false, "HTTP", false,
                "default", auth, credentials, network);

        assertThrows(IllegalStateException.class, validator::validate);
    }
}
