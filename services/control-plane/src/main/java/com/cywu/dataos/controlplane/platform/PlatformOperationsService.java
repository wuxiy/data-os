package com.cywu.dataos.controlplane.platform;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Server-side, read-only probes for the technical component workspace.
 *
 * Only configured browser entrypoints are returned to the portal. Internal
 * probe URLs, response bodies, credentials and scheduler tokens never leave
 * the control plane.
 */
@Service
public final class PlatformOperationsService {

    private final RestClient restClient;
    private final String seatunnelBaseUrl;
    private final String seatunnelUiUrl;
    private final String dolphinschedulerBaseUrl;
    private final String dolphinschedulerUiUrl;
    private final String rustfsEndpoint;
    private final String rustfsConsoleUrl;

    public PlatformOperationsService(
            RestClient.Builder builder,
            @Value("${data-os.seatunnel.base-url:}") String seatunnelBaseUrl,
            @Value("${data-os.platform.seatunnel-ui-url:}") String seatunnelUiUrl,
            @Value("${data-os.dolphinscheduler.base-url:}") String dolphinschedulerBaseUrl,
            @Value("${data-os.platform.dolphinscheduler-ui-url:}") String dolphinschedulerUiUrl,
            @Value("${data-os.platform.rustfs-endpoint:}") String rustfsEndpoint,
            @Value("${data-os.platform.rustfs-console-url:}") String rustfsConsoleUrl) {
        var client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(2))
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        var requestFactory = new JdkClientHttpRequestFactory(client);
        requestFactory.setReadTimeout(Duration.ofSeconds(4));
        this.restClient = builder.requestFactory(requestFactory).build();
        this.seatunnelBaseUrl = normalize(seatunnelBaseUrl);
        this.seatunnelUiUrl = browserUrl(seatunnelUiUrl);
        this.dolphinschedulerBaseUrl = normalize(dolphinschedulerBaseUrl);
        this.dolphinschedulerUiUrl = browserUrl(dolphinschedulerUiUrl);
        this.rustfsEndpoint = normalize(rustfsEndpoint);
        this.rustfsConsoleUrl = browserUrl(rustfsConsoleUrl);
    }

    public PlatformOperationsStatus snapshot() {
        var checkedAt = Instant.now();
        return new PlatformOperationsStatus(true, checkedAt,
                List.of(probeSeaTunnel(checkedAt), probeDolphinScheduler(checkedAt), probeRustFs(checkedAt)));
    }

    private PlatformServiceStatus probeSeaTunnel(Instant checkedAt) {
        if (seatunnelBaseUrl.isBlank()) {
            return notConfigured("seatunnel", "SeaTunnel", "采集执行器", "中心采集任务的运行态与版本信息。",
                    checkedAt, seatunnelUiUrl);
        }
        try {
            var response = get(seatunnelBaseUrl + "/overview");
            var metrics = new LinkedHashMap<String, String>();
            put(metrics, "版本", response.get("projectVersion"));
            put(metrics, "集群", response.get("clusterName"));
            put(metrics, "节点", first(response, "workerCount", "workerNum", "memberCount"));
            return up("seatunnel", "SeaTunnel", "采集执行器", "中心采集任务的运行态与版本信息。",
                    checkedAt, "overview 探针返回正常", seatunnelUiUrl, metrics);
        } catch (RestClientException exception) {
            return down("seatunnel", "SeaTunnel", "采集执行器", "中心采集任务的运行态与版本信息。",
                    checkedAt, errorDetail(exception), seatunnelUiUrl);
        }
    }

    private PlatformServiceStatus probeDolphinScheduler(Instant checkedAt) {
        if (dolphinschedulerBaseUrl.isBlank()) {
            return notConfigured("dolphinscheduler", "DolphinScheduler", "编排调度器",
                    "已发布工作流、调度实例与补数编排的技术入口。", checkedAt, dolphinschedulerUiUrl);
        }
        try {
            var response = get(dolphinschedulerBaseUrl + "/actuator/health");
            var metrics = new LinkedHashMap<String, String>();
            put(metrics, "健康状态", response.get("status"));
            put(metrics, "探针", "actuator/health");
            return up("dolphinscheduler", "DolphinScheduler", "编排调度器",
                    "已发布工作流、调度实例与补数编排的技术入口。", checkedAt,
                    "健康探针返回正常", dolphinschedulerUiUrl, metrics);
        } catch (RestClientException exception) {
            return down("dolphinscheduler", "DolphinScheduler", "编排调度器",
                    "已发布工作流、调度实例与补数编排的技术入口。", checkedAt,
                    errorDetail(exception), dolphinschedulerUiUrl);
        }
    }

    private PlatformServiceStatus probeRustFs(Instant checkedAt) {
        if (rustfsEndpoint.isBlank()) {
            return notConfigured("rustfs", "RustFS", "S3 制品存储",
                    "质量证据与运行制品的 S3 兼容对象存储。", checkedAt, rustfsConsoleUrl);
        }
        try {
            var response = get(rustfsEndpoint + "/health");
            var metrics = new LinkedHashMap<String, String>();
            put(metrics, "健康状态", response.get("status"));
            put(metrics, "协议", "S3-compatible");
            return up("rustfs", "RustFS", "S3 制品存储",
                    "质量证据与运行制品的 S3 兼容对象存储。", checkedAt,
                    "health 探针返回正常", rustfsConsoleUrl, metrics);
        } catch (RestClientException exception) {
            return down("rustfs", "RustFS", "S3 制品存储",
                    "质量证据与运行制品的 S3 兼容对象存储。", checkedAt,
                    errorDetail(exception), rustfsConsoleUrl);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> get(String url) {
        var body = restClient.get().uri(url).retrieve().body(Map.class);
        return body == null ? Map.of() : body;
    }

    private PlatformServiceStatus up(String key, String name, String role, String description, Instant checkedAt,
                                     String detail, String uiUrl, Map<String, String> metrics) {
        return new PlatformServiceStatus(key, name, role, "UP", description, checkedAt, detail, uiUrl, metrics);
    }

    private PlatformServiceStatus down(String key, String name, String role, String description, Instant checkedAt,
                                       String detail, String uiUrl) {
        return new PlatformServiceStatus(key, name, role, "DOWN", description, checkedAt, detail, uiUrl, Map.of());
    }

    private PlatformServiceStatus notConfigured(String key, String name, String role, String description,
                                                Instant checkedAt, String uiUrl) {
        return new PlatformServiceStatus(key, name, role, "NOT_CONFIGURED", description, checkedAt,
                "尚未配置服务地址", uiUrl, Map.of());
    }

    private String errorDetail(RestClientException exception) {
        if (exception instanceof RestClientResponseException responseException) {
            return "HTTP " + responseException.getStatusCode().value();
        }
        return "探针请求失败";
    }

    private String first(Map<String, Object> response, String... keys) {
        for (var key : keys) {
            if (response.containsKey(key) && response.get(key) != null) return String.valueOf(response.get(key));
        }
        return null;
    }

    private void put(Map<String, String> target, String label, Object value) {
        if (value != null && !String.valueOf(value).isBlank()) target.put(label, String.valueOf(value));
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim().replaceAll("/+$", "");
    }

    private String browserUrl(String value) {
        var normalized = normalize(value);
        if (normalized.isBlank()) return null;
        try {
            var uri = URI.create(normalized);
            return "http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())
                    ? normalized : null;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    public record PlatformOperationsStatus(boolean technicalAccess, Instant checkedAt,
                                           List<PlatformServiceStatus> services) {
        public PlatformOperationsStatus {
            services = List.copyOf(services);
        }
    }

    public record PlatformServiceStatus(String key, String name, String role, String status,
                                        String description, Instant checkedAt, String detail,
                                        String uiUrl, Map<String, String> metrics) {
        public PlatformServiceStatus {
            metrics = Map.copyOf(metrics);
        }
    }
}
