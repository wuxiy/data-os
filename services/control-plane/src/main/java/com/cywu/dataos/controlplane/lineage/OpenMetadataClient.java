package com.cywu.dataos.controlplane.lineage;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.quality.OidcClientCredentialsTokenProvider;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.DefaultUriBuilderFactory;

/**
 * OpenMetadata 只读客户端：资产列表、表结构、血缘与统计。
 *
 * 只做 GET 与字段裁剪；连接配置、凭据等管理面字段永不返回给调用方。
 * 任何网络/解析失败统一映射为 {@link AdapterUnavailableException}，由上层转 503。
 */
public class OpenMetadataClient {

    private final RestClient restClient;
    private final OidcClientCredentialsTokenProvider tokenProvider;

    public OpenMetadataClient(RestClient.Builder builder, OpenMetadataLineageProperties properties) {
        var factory = new DefaultUriBuilderFactory(properties.getBaseUrl());
        factory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.NONE);
        this.restClient = builder.uriBuilderFactory(factory).build();
        this.tokenProvider = new OidcClientCredentialsTokenProvider(
                builder, properties.getTokenUri(), properties.getClientId(), properties.getClientSecret(), "", "");
    }

    /** 列出服务下某 schema 的全部表（含列元数据）。 */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> listTables(String serviceName, String databaseSegment, String schema) {
        var database = serviceName + "." + databaseSegment + "." + schema;
        var response = get("/tables?database=" + encode(database) + "&fields=columns&limit=200");
        var data = response.get("data");
        return data instanceof List<?> list ? (List<Map<String, Object>>) list : List.of();
    }

    /** 单表明细（含列清单）。404 抛 IllegalStateException 由上层转 404。 */
    public Map<String, Object> getTable(String fullyQualifiedName) {
        return get("/tables/name/" + encode(fullyQualifiedName) + "?fields=columns");
    }

    /** 血缘全图（nodes + upstreamEdges/downstreamEdges，一次组合查询；方向由边决定）。 */
    public Map<String, Object> getLineageGraph(String fullyQualifiedName, int depth) {
        return get("/lineage/table/name/" + encode(fullyQualifiedName)
                + "?upstreamDepth=" + depth + "&downstreamDepth=" + depth);
    }

    /** 仪表盘实体列表（Superset 摄取产物）。 */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> listDashboards(String serviceName) {
        var response = get("/dashboards?service=" + encode(serviceName) + "&limit=50");
        var data = response.get("data");
        return data instanceof List<?> list ? (List<Map<String, Object>>) list : List.of();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> get(String path) {
        if (!path.startsWith("/")) throw new IllegalArgumentException("路径必须以 / 开头");
        try {
            var spec = restClient.get()
                    .uri(path)
                    .accept(MediaType.APPLICATION_JSON)
                    .headers(headers -> {
                        var token = tokenProvider.current();
                        if (!token.isBlank()) headers.setBearerAuth(token);
                    })
                    .retrieve();
            Map<String, Object> body;
            try {
                body = spec.body(Map.class);
            } catch (org.springframework.web.client.HttpClientErrorException.NotFound notFound) {
                throw new IllegalStateException("资产不存在：" + path);
            }
            return body == null ? Map.of() : body;
        } catch (AdapterUnavailableException | IllegalStateException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            var cause = exception.getCause() == null ? exception : exception.getCause();
            throw new AdapterUnavailableException("OpenMetadata 暂时不可用：" + cause.getMessage());
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
