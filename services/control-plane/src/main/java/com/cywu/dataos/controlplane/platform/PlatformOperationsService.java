package com.cywu.dataos.controlplane.platform;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.executor.AdapterHttp;
import com.cywu.dataos.controlplane.operational.OperationalFacts;
import com.cywu.dataos.controlplane.operational.OperationalFactsRegistry;
import com.cywu.dataos.controlplane.quality.QualityRuleExecutor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
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
    private final String qualityExecutor;
    private final List<QualityRuleExecutor> qualityExecutors;
    private final String notificationHealthUrl;
    private final String seatunnelUiUrl;
    private final String dolphinschedulerBaseUrl;
    private final String dolphinschedulerUiUrl;
    private final String rustfsEndpoint;
    private final String rustfsConsoleUrl;
    private final OperationalFactsRegistry operationalFacts;

    public PlatformOperationsService(
            RestClient.Builder builder,
            @Value("${data-os.seatunnel.base-url:}") String seatunnelBaseUrl,
            @Value("${data-os.quality.executor:HTTP}") String qualityExecutor,
            List<QualityRuleExecutor> qualityExecutors,
            @Value("${data-os.notification.health-url:}") String notificationHealthUrl,
            @Value("${data-os.platform.seatunnel-ui-url:}") String seatunnelUiUrl,
            @Value("${data-os.dolphinscheduler.base-url:}") String dolphinschedulerBaseUrl,
            @Value("${data-os.platform.dolphinscheduler-ui-url:}") String dolphinschedulerUiUrl,
            @Value("${data-os.platform.rustfs-endpoint:}") String rustfsEndpoint,
            @Value("${data-os.platform.rustfs-console-url:}") String rustfsConsoleUrl,
            OperationalFactsRegistry operationalFacts) {
        this.restClient = AdapterHttp.restClient(builder, Duration.ofSeconds(2), Duration.ofSeconds(4));
        this.seatunnelBaseUrl = AdapterHttp.normalizeBaseUrl(seatunnelBaseUrl);
        this.qualityExecutor = qualityExecutor == null ? "HTTP" : qualityExecutor.trim().toUpperCase(java.util.Locale.ROOT);
        this.qualityExecutors = qualityExecutors;
        this.notificationHealthUrl = AdapterHttp.normalizeBaseUrl(notificationHealthUrl);
        this.seatunnelUiUrl = browserUrl(seatunnelUiUrl);
        this.dolphinschedulerBaseUrl = AdapterHttp.normalizeBaseUrl(dolphinschedulerBaseUrl);
        this.dolphinschedulerUiUrl = browserUrl(dolphinschedulerUiUrl);
        this.rustfsEndpoint = AdapterHttp.normalizeBaseUrl(rustfsEndpoint);
        this.rustfsConsoleUrl = browserUrl(rustfsConsoleUrl);
        this.operationalFacts = operationalFacts;
    }

    public PlatformOperationsStatus snapshot() {
        var checkedAt = Instant.now();
        var services = List.of(probeSeaTunnel(checkedAt), probeDolphinScheduler(checkedAt), probeRustFs(checkedAt));
        operationalFacts.updateQualityExecutor(probeQualityExecutor());
        operationalFacts.updateSeaTunnel(services.getFirst().status());
        operationalFacts.updateNotification(probeNotification());
        var operational = operationalFacts.snapshot();
        return new PlatformOperationsStatus(true, checkedAt, operational, services);
    }

    @Scheduled(
            fixedDelayString = "${data-os.platform.probe-interval-ms:30000}",
            initialDelayString = "${data-os.platform.probe-initial-delay-ms:10000}")
    public void scheduledRefresh() {
        snapshot();
    }

    /** 就绪判定经执行器 seam：配置形状与探测端点由执行器自己声明。 */
    private String probeQualityExecutor() {
        return qualityExecutors.stream()
                .filter(executor -> executor.supports(qualityExecutor))
                .findFirst()
                .map(executor -> executor.configured()
                        ? executor.readinessEndpoint().map(this::probe).orElse("READY")
                        : "UNKNOWN")
                .orElse("UNKNOWN");
    }

    private String probeNotification() {
        return notificationHealthUrl.isBlank() ? "UNKNOWN" : probe(notificationHealthUrl);
    }

    private String probe(String url) {
        try {
            restClient.get().uri(url).retrieve().toBodilessEntity();
            return "READY";
        } catch (RestClientException exception) {
            return "DOWN";
        }
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
            put(metrics, "节点", AdapterHttp.first(response, "workerCount", "workerNum", "memberCount"));
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

    private void put(Map<String, String> target, String label, Object value) {
        if (value != null && !String.valueOf(value).isBlank()) target.put(label, String.valueOf(value));
    }

    private String browserUrl(String value) {
        var normalized = AdapterHttp.normalizeBaseUrl(value);
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
                                           OperationalFacts operational,
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
