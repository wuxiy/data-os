package com.cywu.dataos.controlplane.job;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import org.junit.jupiter.api.Test;

class JobConfigurationPolicyTest {

    @Test
    void productionRejectsDemoTemplateAndLegacyFakeSourceRun() {
        var policy = new JobConfigurationPolicy("production");
        var job = new IngestionJob("job", "source", "demo", "BATCH", "SEATUNNEL", "ACTIVE",
                java.time.Instant.now(), null, null, "FAKE_TO_CONSOLE", 1, true);

        assertThrows(InvalidRequestException.class, () -> policy.validateTemplateForSave("FAKE_TO_CONSOLE"));
        assertThrows(ConflictException.class, () -> policy.validateRun(job, Map.of()));
        var customJob = new IngestionJob("job", "source", "demo", "BATCH", "SEATUNNEL", "ACTIVE",
                java.time.Instant.now(), null, null, "CUSTOM_JSON", 1, true);
        assertThrows(ConflictException.class, () -> policy.validateRun(customJob, Map.of(
                "source", List.of(Map.of("plugin_name", "FakeSource")))));
    }

    @Test
    void developmentAllowsDemoTemplate() {
        var policy = new JobConfigurationPolicy("development");
        var job = new IngestionJob("job", "source", "demo", "BATCH", "SEATUNNEL", "ACTIVE",
                java.time.Instant.now(), null, null, "FAKE_TO_CONSOLE", 1, true);

        assertDoesNotThrow(() -> policy.validateTemplateForSave("FAKE_TO_CONSOLE"));
        assertDoesNotThrow(() -> policy.validateRun(job, Map.of()));
    }
}
