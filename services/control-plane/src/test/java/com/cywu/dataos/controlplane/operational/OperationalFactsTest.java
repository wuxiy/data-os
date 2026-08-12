package com.cywu.dataos.controlplane.operational;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class OperationalFactsTest {

    @Test
    void reportsReadyOnlyWhenEveryFactIsReady() {
        var facts = OperationalFacts.from(List.of("UP", "READY", "UP"));

        assertThat(facts.state()).isEqualTo(OperationalFacts.State.READY);
        assertThat(facts.ready()).isEqualTo(3);
        assertThat(facts.degraded()).isZero();
        assertThat(facts.unknown()).isZero();
    }

    @Test
    void reportsDegradedWhenFactsAreMixedOrUnavailable() {
        var mixed = OperationalFacts.from(List.of("UP", "NOT_CONFIGURED"));
        var unavailable = OperationalFacts.from(List.of("UP", "DOWN"));

        assertThat(mixed.state()).isEqualTo(OperationalFacts.State.DEGRADED);
        assertThat(mixed.ready()).isEqualTo(1);
        assertThat(mixed.unknown()).isEqualTo(1);
        assertThat(unavailable.state()).isEqualTo(OperationalFacts.State.DEGRADED);
        assertThat(unavailable.degraded()).isEqualTo(1);
    }

    @Test
    void reportsUnknownWhenNoFactCanBeEstablished() {
        var facts = OperationalFacts.from(List.of("NOT_CONFIGURED", "UNKNOWN"));

        assertThat(facts.state()).isEqualTo(OperationalFacts.State.UNKNOWN);
        assertThat(facts.ready()).isZero();
        assertThat(facts.degraded()).isZero();
        assertThat(facts.unknown()).isEqualTo(2);
    }

    @Test
    void configurationAloneDoesNotEstablishReadiness() {
        var registry = new OperationalFactsRegistry();

        registry.updateConfiguration(true, true, true);

        assertThat(registry.snapshot().state()).isEqualTo(OperationalFacts.State.UNKNOWN);
        assertThat(registry.snapshot().ready()).isZero();
        assertThat(registry.snapshot().unknown()).isEqualTo(3);

        registry.updateQualityExecutor("READY");
        registry.updateSeaTunnel("UP");
        registry.updateNotification("READY");

        assertThat(registry.snapshot().state()).isEqualTo(OperationalFacts.State.READY);
        assertThat(registry.snapshot().ready()).isEqualTo(3);
    }
}
