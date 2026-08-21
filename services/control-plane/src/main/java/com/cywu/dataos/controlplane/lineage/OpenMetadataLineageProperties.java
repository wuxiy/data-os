package com.cywu.dataos.controlplane.lineage;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 血缘适配（OpenMetadata）连接配置。baseUrl 未配置时整个血缘链不装配，
 * API 返回 503（与 MPI Doris 访问链同一降级语义）。
 */
@ConfigurationProperties(prefix = "data-os.openmetadata")
public class OpenMetadataLineageProperties {

    /** OpenMetadata API 根（如 https://host:8445/api/v1）。 */
    private String baseUrl = "";

    /** 服务身份：Keycloak client_credentials 端点；空则每次请求不带 Bearer。 */
    private String tokenUri = "";
    private String clientId = "";
    private String clientSecret = "";

    /** data-os 专属数据库服务名（G1 建立的 doris-dataos）。 */
    private String serviceName = "doris-dataos";

    /** 仪表盘服务名（Superset 摄取建立）。 */
    private String dashboardServiceName = "superset-dataos";

    /** OM 表全限定名中 Doris 侧的 database 段（Doris 无独立库层，恒为 default）。 */
    private String databaseSegment = "default";

    /** 资产目录覆盖的库清单（G6 三库口径；summary 聚合与前端库切换的数据源）。 */
    private List<String> schemas = List.of(
            "ods_ep", "dataos_quality_acceptance", "dataos_mpi");

    public List<String> getSchemas() {
        return schemas;
    }

    public void setSchemas(List<String> schemas) {
        this.schemas = schemas == null ? List.of() : schemas;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
    }

    public String getTokenUri() {
        return tokenUri;
    }

    public void setTokenUri(String tokenUri) {
        this.tokenUri = tokenUri == null ? "" : tokenUri.trim();
    }

    public String getClientId() {
        return clientId;
    }

    public void setClientId(String clientId) {
        this.clientId = clientId == null ? "" : clientId.trim();
    }

    public String getClientSecret() {
        return clientSecret;
    }

    public void setClientSecret(String clientSecret) {
        this.clientSecret = clientSecret == null ? "" : clientSecret.trim();
    }

    public String getServiceName() {
        return serviceName;
    }

    public void setServiceName(String serviceName) {
        this.serviceName = serviceName == null ? "" : serviceName.trim();
    }

    public String getDashboardServiceName() {
        return dashboardServiceName;
    }

    public void setDashboardServiceName(String dashboardServiceName) {
        this.dashboardServiceName = dashboardServiceName == null ? "" : dashboardServiceName.trim();
    }

    public String getDatabaseSegment() {
        return databaseSegment;
    }

    public void setDatabaseSegment(String databaseSegment) {
        this.databaseSegment = databaseSegment == null ? "" : databaseSegment.trim();
    }
}
