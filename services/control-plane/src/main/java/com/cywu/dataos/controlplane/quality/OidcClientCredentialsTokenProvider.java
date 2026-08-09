package com.cywu.dataos.controlplane.quality;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

/** Short-lived OIDC client-credentials token cache for control-plane adapters. */
public final class OidcClientCredentialsTokenProvider {

    private record Token(String value, Instant expiresAt) {
    }

    private final RestClient client;
    private final String tokenUri;
    private final String clientId;
    private final String clientSecret;
    private final String audience;
    private final String scopes;
    private final AtomicReference<Token> cached = new AtomicReference<>();

    public OidcClientCredentialsTokenProvider(RestClient.Builder builder, String tokenUri, String clientId,
                                              String clientSecret, String audience, String scopes) {
        var httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        var requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(Duration.ofSeconds(5));
        this.client = builder.requestFactory(requestFactory).build();
        this.tokenUri = normalize(tokenUri);
        this.clientId = normalize(clientId);
        this.clientSecret = clientSecret == null ? "" : clientSecret.trim();
        this.audience = normalize(audience);
        this.scopes = normalize(scopes);
    }

    public String current() {
        if (tokenUri.isBlank() || clientId.isBlank() || clientSecret.isBlank()) return "";
        var existing = cached.get();
        if (existing != null && existing.expiresAt().isAfter(Instant.now().plusSeconds(30))) {
            return existing.value();
        }
        synchronized (this) {
            existing = cached.get();
            if (existing != null && existing.expiresAt().isAfter(Instant.now().plusSeconds(30))) {
                return existing.value();
            }
            try {
                var form = new LinkedMultiValueMap<String, String>();
                form.add("grant_type", "client_credentials");
                form.add("client_id", clientId);
                form.add("client_secret", clientSecret);
                if (!audience.isBlank()) form.add("audience", audience);
                if (!scopes.isBlank()) form.add("scope", scopes);
                @SuppressWarnings("unchecked")
                Map<String, Object> response = client.post().uri(tokenUri)
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form)
                        .retrieve().body(Map.class);
                var value = response == null ? "" : String.valueOf(response.getOrDefault("access_token", ""));
                var expires = response == null ? 300L : longValue(response.get("expires_in"), 300L);
                if (value.isBlank()) throw new AdapterUnavailableException("质量 Runtime OIDC Token 响应缺少 access_token");
                cached.set(new Token(value, Instant.now().plusSeconds(Math.max(30, expires))));
                return value;
            } catch (AdapterUnavailableException exception) {
                throw exception;
            } catch (RuntimeException exception) {
                throw new AdapterUnavailableException("质量 Runtime OIDC Token 暂时不可用");
            }
        }
    }

    private long longValue(Object value, long fallback) {
        try {
            return value == null ? fallback : Long.parseLong(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim();
    }
}
