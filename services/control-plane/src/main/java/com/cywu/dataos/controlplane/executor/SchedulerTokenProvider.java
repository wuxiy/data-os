package com.cywu.dataos.controlplane.executor;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;

/** Hot-loads the current/previous DolphinScheduler token file during rotation overlap. */
public final class SchedulerTokenProvider {

    public record Snapshot(String current, String previous) {
    }

    private final ObjectMapper objectMapper;
    private final String staticToken;
    private final Path tokenFile;

    public SchedulerTokenProvider(ObjectMapper objectMapper, String staticToken, String tokenFile) {
        this.objectMapper = objectMapper;
        this.staticToken = normalize(staticToken);
        this.tokenFile = tokenFile == null || tokenFile.isBlank() ? null : Path.of(tokenFile.trim());
    }

    public Snapshot snapshot() {
        if (tokenFile != null) {
            try {
                @SuppressWarnings("unchecked")
                Map<String, Object> json = objectMapper.readValue(
                        Files.readString(tokenFile, StandardCharsets.UTF_8), Map.class);
                return new Snapshot(normalize(json.get("current")), normalize(json.get("previous")));
            } catch (IOException | RuntimeException ignored) {
                // Fail closed at request time; never echo secret-file contents.
            }
        }
        return new Snapshot(staticToken, "");
    }

    private static String normalize(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }
}
