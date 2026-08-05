package com.cywu.dataos.controlplane.quality;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DemoQualityRuleExecutorTest {

    @Test
    void demoExecutorRequiresExplicitEnablement() {
        assertThat(new DemoQualityRuleExecutor(0, false).supports("DEMO")).isFalse();
        assertThat(new DemoQualityRuleExecutor(0, true).supports("DEMO")).isTrue();
        assertThat(new DemoQualityRuleExecutor(0, true).supports("HTTP")).isFalse();
    }
}
