package com.cywu.dataos.controlplane.system;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

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
}
