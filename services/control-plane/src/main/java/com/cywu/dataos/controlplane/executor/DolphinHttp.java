package com.cywu.dataos.controlplane.executor;

import java.net.URI;
import java.time.Duration;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

/**
 * DolphinScheduler API 的共享 HTTP 通道（G2G 批次 5 抽取）：token 鉴权、401 时
 * 用上一令牌重试一次。运行提交适配器与调度客户端共用，避免鉴权语义漂移。
 */
class DolphinHttp {

    private final RestClient restClient;
    private final SchedulerTokenProvider tokenProvider;

    DolphinHttp(RestClient.Builder builder, ObjectMapper objectMapper, String token, String tokenFile) {
        this.restClient = AdapterHttp.restClient(builder, Duration.ofSeconds(3), Duration.ofSeconds(10));
        this.tokenProvider = new SchedulerTokenProvider(objectMapper, token, tokenFile);
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> get(URI uri) {
        try {
            return restClient.get().uri(uri)
                    .headers(headers -> applyAuth(headers, tokenProvider.snapshot().current()))
                    .retrieve().body(Map.class);
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 401) {
                throw exception;
            }
            return restClient.get().uri(uri)
                    .headers(headers -> applyAuth(headers, previousToken()))
                    .retrieve().body(Map.class);
        }
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> post(URI uri, Object body) {
        try {
            return exchange(restClient.post().uri(uri)
                    .headers(headers -> applyAuth(headers, tokenProvider.snapshot().current())), body);
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 401) {
                throw exception;
            }
            return exchange(restClient.post().uri(uri)
                    .headers(headers -> applyAuth(headers, previousToken())), body);
        }
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> put(URI uri, Object body) {
        try {
            return exchange(restClient.put().uri(uri)
                    .headers(headers -> applyAuth(headers, tokenProvider.snapshot().current())), body);
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 401) {
                throw exception;
            }
            return exchange(restClient.put().uri(uri)
                    .headers(headers -> applyAuth(headers, previousToken())), body);
        }
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> delete(URI uri) {
        try {
            return restClient.delete().uri(uri)
                    .headers(headers -> applyAuth(headers, tokenProvider.snapshot().current()))
                    .retrieve().body(Map.class);
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() != 401) {
                throw exception;
            }
            return restClient.delete().uri(uri)
                    .headers(headers -> applyAuth(headers, previousToken()))
                    .retrieve().body(Map.class);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> exchange(RestClient.RequestBodySpec request, Object body) {
        request.contentType(MediaType.APPLICATION_JSON);
        return body == null ? request.retrieve().body(Map.class)
                : request.body(body).retrieve().body(Map.class);
    }

    private String previousToken() {
        var previous = tokenProvider.snapshot().previous();
        if (previous.isBlank()) {
            throw new AdapterUnavailableException("DolphinScheduler Token 已失效");
        }
        return previous;
    }

    private void applyAuth(HttpHeaders headers, String token) {
        if (token == null || token.isBlank()) {
            throw new AdapterUnavailableException("DolphinScheduler 未配置访问凭据");
        }
        headers.set("token", token);
    }
}
