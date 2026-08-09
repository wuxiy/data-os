package com.cywu.dataos.controlplane.executor;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SchedulerTokenProviderTest {

    @TempDir
    Path tempDir;

    @Test
    void hotLoadsCurrentAndPreviousWithoutLoggingSecret() throws Exception {
        var tokenFile = tempDir.resolve("scheduler-token.json");
        var mapper = new ObjectMapper();
        mapper.writeValue(tokenFile.toFile(), java.util.Map.of("current", "token-a", "previous", "token-old"));
        var provider = new SchedulerTokenProvider(mapper, "fallback", tokenFile.toString());

        assertThat(provider.snapshot().current()).isEqualTo("token-a");
        assertThat(provider.snapshot().previous()).isEqualTo("token-old");

        mapper.writeValue(tokenFile.toFile(), java.util.Map.of("current", "token-b", "previous", "token-a"));
        assertThat(provider.snapshot().current()).isEqualTo("token-b");
        assertThat(provider.snapshot().previous()).isEqualTo("token-a");
    }

    @Test
    void usesStaticTokenOnlyWhenFileIsNotConfigured() {
        var provider = new SchedulerTokenProvider(new ObjectMapper(), "static-token", "");

        assertThat(provider.snapshot().current()).isEqualTo("static-token");
        assertThat(provider.snapshot().previous()).isBlank();
    }
}
