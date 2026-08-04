package com.cywu.dataos.controlplane.source;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;

import org.springframework.stereotype.Component;

@Component
public class HttpSourceCheckAdapter implements SourceCheckAdapter {

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    @Override
    public boolean supports(String protocol) {
        return "HTTP".equalsIgnoreCase(protocol) || "FHIR".equalsIgnoreCase(protocol);
    }

    @Override
    public SourceCheckResult check(Source source, Map<String, Object> config) {
        var protocol = source.protocol().toUpperCase(Locale.ROOT);
        var url = config.get("url") == null ? "" : String.valueOf(config.get("url")).trim();
        if (url.isBlank()) {
            return SourceCheckResult.blockedConfiguration("HTTP/FHIR 检查需要 url");
        }
        try {
            var request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .header("Accept", "application/json")
                    .build();
            var response = client.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() >= 200 && response.statusCode() < 400) {
                return SourceCheckResult.healthy(protocol + " 服务可访问（HTTP "
                        + response.statusCode() + "）");
            }
            return SourceCheckResult.unhealthy(protocol + " 服务返回 HTTP "
                    + response.statusCode());
        } catch (Exception exception) {
            return SourceCheckResult.unhealthy(protocol + " 服务连接失败：" + safeMessage(exception));
        }
    }

    private String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) return "未知错误";
        return message.length() > 240 ? message.substring(0, 240) : message;
    }
}
