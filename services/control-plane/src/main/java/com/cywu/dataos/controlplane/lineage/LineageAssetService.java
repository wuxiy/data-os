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

    /** 血缘视图：以表为根，按边方向分列上游（来源）与下游（产出/消费）。 */
    public AssetLineage getLineage(String fullyQualifiedName) {
        var graph = client.getLineageGraph(fullyQualifiedName, 3);
        var nodesById = new java.util.HashMap<String, Map<String, Object>>();
        if (graph.get("nodes") instanceof List<?> list) {
            for (var node : list) {
                if (node instanceof Map<?, ?> map && map.get("id") != null) {
                    nodesById.put(text(map.get("id")), cast(node));
                }
            }
        }
        var entityId = text(((Map<?, ?>) graph.getOrDefault("entity", Map.of())).get("id"));
        var upstreams = new ArrayList<LineageNode>();
        var downstreams = new ArrayList<LineageNode>();
        collectEdgeNodes(graph.get("upstreamEdges"), entityId, nodesById, upstreams);
        collectEdgeNodes(graph.get("downstreamEdges"), entityId, nodesById, downstreams);
        return new AssetLineage(fullyQualifiedName, List.copyOf(upstreams), List.copyOf(downstreams));
    }

    /** 边方向换算：上游取 from、下游取 to（对根实体本身去重）。 */
    private void collectEdgeNodes(Object edges, String rootId, Map<String, Map<String, Object>> nodesById,
                                  List<LineageNode> collected) {
        if (!(edges instanceof List<?> list)) return;
        for (var edge : list) {
            if (!(edge instanceof Map<?, ?> edgeMap)) continue;
            var from = text(edgeMap.get("fromEntity"));
            var to = text(edgeMap.get("toEntity"));
            var peer = from.equals(rootId) ? to : from;
            if (peer.equals(rootId) || peer.isBlank()) continue;
            var node = nodesById.get(peer);
            if (node == null) continue;
            var candidate = toLineageNode(node, columnMappings(edgeMap));
            if (collected.stream().noneMatch(existing -> existing.fullyQualifiedName().equals(candidate.fullyQualifiedName()))) {
                collected.add(candidate);
            }
        }
    }

    /**
     * 从血缘边的 lineageDetails.columnsLineage 提取列级映射，并投影为短列名
     * （全限定列名去掉服务/库/表前缀，G7 声明式血缘口径）。
     */
    private List<ColumnMapping> columnMappings(Map<?, ?> edge) {
        if (!(edge.get("lineageDetails") instanceof Map<?, ?> details)) return List.of();
        if (!(details.get("columnsLineage") instanceof List<?> mappings)) return List.of();
        return mappings.stream()
                .filter(mapping -> mapping instanceof Map<?, ?>)
                .map(mapping -> {
                    var m = (Map<?, ?>) mapping;
                    List<String> from = ((m.get("fromColumns") instanceof List<?> fromColumns)
                            ? fromColumns.stream()
                            : java.util.stream.Stream.<Object>of()).map(this::shortColumn).toList();
                    return new ColumnMapping(from, shortColumn(m.get("toColumn")));
                })
                .toList();
    }

    /** 全限定列名投影为短列名：取最后一个 "." 之后；空值保留原样。 */
    private String shortColumn(Object column) {
        var value = text(column);
        if (value.isBlank()) return value;
        var after = value.substring(value.lastIndexOf('.') + 1);
        return after.isBlank() ? value : after;
    }

    /** 摘要：库清单内全部表的列规模 + 仪表盘消费面（驾驶舱指标数据面）。 */
    public LineageSummary summary() {
        int tableCount = 0;
        int columnCount = 0;
        for (String schema : properties.getSchemas()) {
            var tables = client.listTables(
                    properties.getServiceName(), properties.getDatabaseSegment(), schema);
            tableCount += tables.size();
            columnCount += tables.stream().mapToInt(table -> columns(table).size()).sum();
        }
        var dashboards = client.listDashboards(properties.getDashboardServiceName());
        var dashboardSummaries = dashboards.stream()
                .map(dashboard -> new DashboardSummary(
                        text(dashboard.get("fullyQualifiedName")),
                        text(dashboard.get("displayName")),
                        instant(dashboard.get("updatedAt"))))
                .toList();
        return new LineageSummary(properties.getServiceName(), properties.getSchemas(),
                tableCount, columnCount,
                properties.getDashboardServiceName(), dashboardSummaries);
    }

    private LineageNode toLineageNode(Map<String, Object> node, List<ColumnMapping> columnMappings) {
        var fqn = text(node.get("fullyQualifiedName"));
        var type = text(node.get("type"));
        var name = text(node.get("name"));
        var display = text(node.get("displayName"));
        // 展示名：优先实体的 displayName；无则回退全限定名（服务前缀交代来源）。
        var shown = display.isBlank() ? (fqn.isBlank() ? name : fqn) : display;
        return new LineageNode(fqn.isBlank() ? name : fqn, normalizeType(type), shown, columnMappings);
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
    private static Map<String, Object> cast(Object node) {
        return (Map<String, Object>) node;
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

    /** 列级映射：`fromColumns` → `toColumn`，列名已投影为短名。 */
    public record ColumnMapping(List<String> fromColumns, String toColumn) {
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

    public record LineageNode(
            String fullyQualifiedName, String type, String displayName, List<ColumnMapping> columnMappings) {
    }

    public record AssetLineage(
            String root, List<LineageNode> upstreams, List<LineageNode> downstreams) {
    }

    public record DashboardSummary(String fullyQualifiedName, String displayName, String updatedAt) {
    }

    public record LineageSummary(
            String service, List<String> schemas, int tableCount, int columnCount,
            String dashboardService, List<DashboardSummary> dashboards) {
    }
}
