package com.cywu.dataos.controlplane.source;

import com.cywu.dataos.controlplane.api.ErrorMessages;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.io.InputStream;
import java.util.Locale;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class HttpSourceCheckAdapter implements SourceCheckAdapter {

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NEVER)
            .build();
    private final SourceNetworkPolicy networkPolicy;

    @Autowired
    public HttpSourceCheckAdapter(SourceNetworkPolicy networkPolicy) {
        this.networkPolicy = networkPolicy;
    }

    public HttpSourceCheckAdapter() {
        this(SourceNetworkPolicy.developmentDefaults());
    }

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
            networkPolicy.validateHttpUrl(url);
            var request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .header("Accept", "application/json")
                    .build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            var contentLength = response.headers().firstValueAsLong("Content-Length").orElse(0L);
            var maxResponseBytes = networkPolicy.maxResponseBytes();
            if (maxResponseBytes <= 0) {
                response.body().close();
                return SourceCheckResult.blockedConfiguration("数据源检查响应大小限制必须大于 0");
            }
            if (contentLength > maxResponseBytes) {
                response.body().close();
                return SourceCheckResult.unhealthy(protocol + " 服务响应超过检查大小限制");
            }
            if (exceedsBodyLimit(response.body(), maxResponseBytes)) {
                return SourceCheckResult.unhealthy(protocol + " 服务响应超过检查大小限制");
            }
            if (response.statusCode() >= 200 && response.statusCode() < 400) {
                return SourceCheckResult.healthy(protocol + " 服务可访问（HTTP "
                        + response.statusCode() + "）");
            }
            return SourceCheckResult.unhealthy(protocol + " 服务返回 HTTP "
                    + response.statusCode());
        } catch (IllegalArgumentException exception) {
            return SourceCheckResult.blockedConfiguration(exception.getMessage());
        } catch (Exception exception) {
            return SourceCheckResult.unhealthy(protocol + " 服务连接失败：" + ErrorMessages.safe(exception));
        }
    }

    private boolean exceedsBodyLimit(InputStream body, int maxResponseBytes) throws java.io.IOException {
        try (body) {
            var buffer = new byte[Math.min(8192, Math.max(1, maxResponseBytes))];
            var consumed = 0L;
            int read;
            while ((read = body.read(buffer)) != -1) {
                consumed += read;
                if (consumed > maxResponseBytes) return true;
            }
            return false;
        }
    }
}
