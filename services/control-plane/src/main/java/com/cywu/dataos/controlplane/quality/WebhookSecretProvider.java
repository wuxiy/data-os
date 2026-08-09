package com.cywu.dataos.controlplane.quality;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;

/** Reads the current webhook signing secret without putting it in application logs. */
public final class WebhookSecretProvider {

    private final ObjectMapper objectMapper;
    private final String configuredSecret;
    private final Path secretFile;

    public WebhookSecretProvider(ObjectMapper objectMapper, String configuredSecret, String secretFile) {
        this.objectMapper = objectMapper;
        this.configuredSecret = configuredSecret == null ? "" : configuredSecret.trim();
        this.secretFile = secretFile == null || secretFile.isBlank() ? null : Path.of(secretFile.trim());
    }

    public String current() {
        if (secretFile != null) {
            try {
                var json = objectMapper.readValue(Files.readString(secretFile, StandardCharsets.UTF_8), Map.class);
                var value = json.get("current");
                if (value != null && !String.valueOf(value).isBlank()) return String.valueOf(value).trim();
            } catch (IOException | RuntimeException ignored) {
                // The caller reports a configuration error without echoing file contents.
            }
        }
        return configuredSecret;
    }
}
