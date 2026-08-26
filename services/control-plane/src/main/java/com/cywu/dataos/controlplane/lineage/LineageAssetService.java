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

    /** 血缘视图：以表为根，按边方向分列上游（来源）与下游（产出/消费）；边带列级映射时投影短列名。 */
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
        collectEdgeNodes(graph.get("upstreamEdges"), entityId, nodesById, upstreams, true);
        collectEdgeNodes(graph.get("downstreamEdges"), entityId, nodesById, downstreams, false);
        return new AssetLineage(fullyQualifiedName, List.copyOf(upstreams), List.copyOf(downstreams));
    }

    /**
     * 边方向换算：上游取 from、下游取 to（对根实体本身去重）。
     * 列级映射（lineageDetails.columnsLineage）挂在边上：下游方向按声明原样
     * （fromColumns -> toColumn），上游方向镜像（根为下游侧）。
     */
    private void collectEdgeNodes(Object edges, String rootId, Map<String, Map<String, Object>> nodesById,
                                  List<LineageNode> collected, boolean upstream) {
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

    /** 边的列级映射投影：全限定列名收敛为短列名（展示口径）。 */
    private List<ColumnMapping> columnMappings(Map<?, ?> edgeMap) {
        var details = edgeMap.get("lineageDetails");
        if (!(details instanceof Map<?, ?> detailsMap)) return List.of();
        if (!(detailsMap.get("columnsLineage") instanceof List<?> mappings)) return List.of();
        var result = new ArrayList<ColumnMapping>();
        for (var mapping : mappings) {
            if (!(mapping instanceof Map<?, ?> mappingMap)) continue;
            var fromColumns = new ArrayList<String>();
            if (mappingMap.get("fromColumns") instanceof List<?> froms) {
                for (var column : froms) {
                    var name = text(column);
                    if (!name.isBlank()) fromColumns.add(shortColumn(name));
                }
            }
            var toColumn = shortColumn(text(mappingMap.get("toColumn")));
            if (!fromColumns.isEmpty() && !toColumn.isBlank()) {
                result.add(new ColumnMapping(List.copyOf(fromColumns), toColumn));
            }
        }
        return List.copyOf(result);
    }

    private static String shortColumn(String qualified) {
        var parts = qualified.split("\\.");
        return parts.length == 0 ? qualified : parts[parts.length - 1];
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

    /** 列级映射：fromColumns（短列名）汇聚产出 toColumn（G7 声明式血缘的投影口径）。 */
    public record ColumnMapping(List<String> fromColumns, String toColumn) {
    }

    public record LineageNode(String fullyQualifiedName, String type, String displayName,
                              List<ColumnMapping> columnMappings) {
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
