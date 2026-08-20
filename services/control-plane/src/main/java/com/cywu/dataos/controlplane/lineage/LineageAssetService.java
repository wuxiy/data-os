package com.cywu.dataos.controlplane.lineage;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 血缘/资产读模型：把 OpenMetadata 实体裁剪为门户契约。
 * 只投影展示字段——连接配置、凭据、内部 id 一律不透出。
 */
public class LineageAssetService {

    private final OpenMetadataClient client;
    private final OpenMetadataLineageProperties properties;

    public LineageAssetService(OpenMetadataClient client, OpenMetadataLineageProperties properties) {
        this.client = client;
        this.properties = properties;
    }

    /** 资产目录：服务下某 schema 的表清单（默认 ods_ep）。 */
    public AssetCatalog listAssets(String schema) {
        var effectiveSchema = schema == null || schema.isBlank() ? "ods_ep" : schema.trim();
        var tables = client.listTables(properties.getServiceName(), properties.getDatabaseSegment(), effectiveSchema);
        var assets = tables.stream().map(table -> new AssetSummary(
                text(table.get("name")),
                text(table.get("fullyQualifiedName")),
                text(table.get("displayName")),
                columns(table).size(),
                instant(table.get("updatedAt")),
                text(table.get("updatedBy")))).toList();
        return new AssetCatalog(properties.getServiceName(), effectiveSchema, assets, Instant.now().toString());
    }

    /** 表详情：列名/类型/描述（证据面）。 */
    public AssetDetail getAsset(String fullyQualifiedName) {
        var table = client.getTable(fullyQualifiedName);
        var columns = columns(table).stream().map(column -> new AssetColumn(
                text(column.get("name")),
                text(column.get("dataTypeDisplay")).isBlank()
                        ? text(column.get("dataType")) : text(column.get("dataTypeDisplay")),
                text(column.get("description")))).toList();
        return new AssetDetail(
                text(table.get("name")),
                text(table.get("fullyQualifiedName")),
                text(table.get("displayName")),
                text(table.get("description")),
                columns,
                instant(table.get("updatedAt")));
    }

    /** 血缘视图：以表为根，上游（消费链：仪表盘/数据模型）与下游分列。 */
    public AssetLineage getLineage(String fullyQualifiedName) {
        var upstreams = client.getLineageNodes(fullyQualifiedName, "upstream", 3).stream()
                .map(this::toLineageNode).toList();
        var downstreams = client.getLineageNodes(fullyQualifiedName, "downstream", 3).stream()
                .map(this::toLineageNode).toList();
        return new AssetLineage(fullyQualifiedName, upstreams, downstreams);
    }

    /** 摘要：库表列规模 + 仪表盘消费面（驾驶舱指标数据面）。 */
    public LineageSummary summary() {
        var tables = client.listTables(
                properties.getServiceName(), properties.getDatabaseSegment(), "ods_ep");
        var columnCount = tables.stream().mapToInt(table -> columns(table).size()).sum();
        var dashboards = client.listDashboards(properties.getDashboardServiceName());
        var dashboardSummaries = dashboards.stream()
                .map(dashboard -> new DashboardSummary(
                        text(dashboard.get("fullyQualifiedName")),
                        text(dashboard.get("displayName")),
                        text(dashboard.get("updatedAt"))))
                .toList();
        return new LineageSummary(properties.getServiceName(), tables.size(), columnCount,
                properties.getDashboardServiceName(), dashboardSummaries);
    }

    private LineageNode toLineageNode(Map<String, Object> node) {
        var fqn = text(node.get("fullyQualifiedName"));
        var type = text(node.get("entityType"));
        var name = text(node.get("name"));
        // 展示名直接用全限定名：服务前缀（superset-dataos.）交代来源，短名无歧义截断交给前端。
        var display = fqn.isBlank() ? name : fqn;
        return new LineageNode(display, normalizeType(type), display);
    }

    private String normalizeType(String entityType) {
        return switch (entityType) {
            case "table" -> "table";
            case "dashboardDataModel" -> "dataModel";
            case "dashboard" -> "dashboard";
            case "chart" -> "chart";
            default -> entityType.isBlank() ? "unknown" : entityType;
        };
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> columns(Map<String, Object> table) {
        var columns = table.get("columns");
        return columns instanceof List<?> list ? (List<Map<String, Object>>) list : List.of();
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static String instant(Object epochMillis) {
        if (epochMillis instanceof Number number) {
            return Instant.ofEpochMilli(number.longValue()).toString();
        }
        return "";
    }

    public record AssetSummary(
            String name, String fullyQualifiedName, String displayName,
            int columnCount, String updatedAt, String updatedBy) {
    }

    public record AssetCatalog(
            String service, String schema, List<AssetSummary> assets, String fetchedAt) {
    }

    public record AssetColumn(String name, String dataType, String description) {
    }

    public record AssetDetail(
            String name, String fullyQualifiedName, String displayName,
            String description, List<AssetColumn> columns, String updatedAt) {
    }

    public record LineageNode(String fullyQualifiedName, String type, String displayName) {
    }

    public record AssetLineage(
            String root, List<LineageNode> upstreams, List<LineageNode> downstreams) {
    }

    public record DashboardSummary(String fullyQualifiedName, String displayName, String updatedAt) {
    }

    public record LineageSummary(
            String service, int tableCount, int columnCount,
            String dashboardService, List<DashboardSummary> dashboards) {
    }
}
