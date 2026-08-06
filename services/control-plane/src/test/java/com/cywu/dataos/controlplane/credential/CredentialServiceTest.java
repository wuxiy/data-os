package com.cywu.dataos.controlplane.credential;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.util.Map;
import java.util.Optional;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.cywu.dataos.controlplane.security.AuthProperties;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.junit.jupiter.api.Test;

class CredentialServiceTest {

    @Test
    void createReturnsSummaryWithoutSecretAndResolverDecryptsOnlyInBackend() throws Exception {
        var repository = new InMemoryCredentialRepository();
        var properties = new CredentialProperties();
        properties.setEncryptionKey(java.util.Base64.getEncoder().encodeToString(new byte[32]));
        var cipher = new CredentialCipher(properties);
        var auth = new AuthProperties();
        auth.setMode("DISABLED");
        var service = new CredentialService(repository, cipher, new ObjectMapper(), new TenantScope(auth));
        var request = new CredentialService.CreateCredentialRequest("LIS", "jdbc",
                Map.of("username", "lis_user", "password", "do-not-echo"), Map.of("environment", "dev"));

        var summary = service.create(request);

        assertEquals("LIS", summary.name());
        assertFalse(summary.toString().contains("do-not-echo"));
        var stored = repository.stored;
        assertFalse(stored.secretCiphertext().contains("do-not-echo"));

        var resolved = service.resolve(stored.id(), "default", "demo-hospital");

        assertEquals("lis_user", resolved.get("username"));
        assertEquals("do-not-echo", resolved.get("password"));
        assertTrue(stored.secretCiphertext().length() > 32);
    }

    private static final class InMemoryCredentialRepository extends CredentialRepository {

        private Credential stored;

        private InMemoryCredentialRepository() {
            super(null);
        }

        @Override
        public void save(Credential credential) {
            stored = credential;
        }

        @Override
        public Optional<Credential> findById(String id, String tenantId, String institutionId) {
            return stored != null && stored.id().equals(id) && stored.tenantId().equals(tenantId)
                    && stored.institutionId().equals(institutionId) ? Optional.of(stored) : Optional.empty();
        }
    }
}
