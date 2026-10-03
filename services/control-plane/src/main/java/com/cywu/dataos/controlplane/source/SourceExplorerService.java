package com.cywu.dataos.controlplane.source;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import com.cywu.dataos.controlplane.api.ErrorMessages;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import org.springframework.stereotype.Service;

/**
 * 数据源目录浏览与受控查询（G2G 批次 1 第一刀）。
 *
 * <p>浏览与查询共用 {@link SourceConnections} 打开的工作连接（来源为源上登记的
 * 非敏感连接配置）。目录三段懒加载：库 → 表 → 字段，各级有服务端上限，防大库
 * 一次拖垮。受控查询只放行单条 SELECT/WITH，强制行数上限与语句超时，结果值
 * 统一转字符串防类型泄露。
 */
@Service
public class SourceExplorerService {

    private static final int MAX_CATALOGS = 200;
    private static final int MAX_TABLES = 500;
    private static final int MAX_COLUMNS = 1000;
    private static final int DEFAULT_QUERY_MAX_ROWS = 200;
    private static final int HARD_QUERY_MAX_ROWS = 1000;
    private static final int QUERY_TIMEOUT_SECONDS = 10;

    /** 语句尾部的结果限制（含 MySQL 逗号变体）；存在则信任用户显式限制，不再包层。 */
    private static final Pattern TRAILING_LIMIT = Pattern.compile("(?i)\\blimit\\s+\\d+(\\s*,\\s*\\d+)?\\s*;?\\s*$");
    private static final Pattern LINE_COMMENT = Pattern.compile("--[^\\n\\r]*");
    private static final Pattern BLOCK_COMMENT = Pattern.compile("/\\*.*?\\*/", Pattern.DOTALL);

    private final SourceService sourceService;
    private final SourceConnections connections;

    public SourceExplorerService(SourceService sourceService, SourceConnections connections) {
        this.sourceService = sourceService;
        this.connections = connections;
    }

    public CatalogListResponse catalogs(String sourceId) {
        var source = requireJdbcSource(sourceId);
        try (var connection = open(source); var results = connection.getMetaData().getCatalogs()) {
            var names = new ArrayList<String>();
            var truncated = false;
            while (results.next()) {
                if (names.size() >= MAX_CATALOGS) {
                    truncated = true;
                    break;
                }
                names.add(results.getString(1));
            }
            return new CatalogListResponse(names, truncated);
        } catch (SQLException exception) {
            throw new InvalidRequestException("数据源目录读取失败：" + ErrorMessages.safe(exception));
        }
    }

    public TableListResponse tables(String sourceId, String catalog) {
        var source = requireJdbcSource(sourceId);
        try (var connection = open(source)) {
            var tables = new ArrayList<TableSummary>();
            var truncated = false;
            try (var results = connection.getMetaData().getTables(
                    catalogPattern(catalog), null, "%", new String[]{"TABLE", "VIEW"})) {
                while (results.next()) {
                    if (tables.size() >= MAX_TABLES) {
                        truncated = true;
                        break;
                    }
                    tables.add(new TableSummary(
                            results.getString("TABLE_NAME"),
                            results.getString("TABLE_TYPE"),
                            remarks(results.getString("REMARKS"))));
                }
            }
            return new TableListResponse(tables, truncated);
        } catch (SQLException exception) {
            throw new InvalidRequestException("数据源表清单读取失败：" + ErrorMessages.safe(exception));
        }
    }

    public ColumnListResponse columns(String sourceId, String catalog, String table) {
        var source = requireJdbcSource(sourceId);
        if (table == null || table.isBlank()) {
            throw new InvalidRequestException("字段浏览需要指定表名");
        }
        try (var connection = open(source)) {
            var columns = new ArrayList<ColumnSummary>();
            try (var results = connection.getMetaData().getColumns(
                    catalogPattern(catalog), null, table.trim(), "%")) {
                while (results.next()) {
                    if (columns.size() >= MAX_COLUMNS) break;
                    columns.add(new ColumnSummary(
                            results.getString("COLUMN_NAME"),
                            results.getString("TYPE_NAME"),
                            results.getInt("NULLABLE") != DatabaseMetaData.columnNoNulls,
                            remarks(results.getString("REMARKS"))));
                }
            }
            return new ColumnListResponse(columns);
        } catch (SQLException exception) {
            throw new InvalidRequestException("数据源字段清单读取失败：" + ErrorMessages.safe(exception));
        }
    }

    public QueryResultResponse query(String sourceId, SourceQueryRequest request) {
        var source = requireJdbcSource(sourceId);
        var sql = request == null || request.sql() == null ? "" : request.sql().trim();
        if (sql.isBlank()) {
            throw new InvalidRequestException("查询语句不能为空");
        }
        var effectiveMax = effectiveMaxRows(request.maxRows());
        var inspectable = stripComments(sql);
        validateReadOnly(inspectable);
        var catalog = request.catalog() == null || request.catalog().isBlank() ? null : request.catalog().trim();
        try (var connection = open(source)) {
            if (catalog != null) {
                connection.setCatalog(catalog);
            }
            var fetchLimit = effectiveMax + 1;
            var executable = hasTrailingLimit(inspectable)
                    ? sql
                    : "SELECT * FROM (" + sql + ") AS _q LIMIT " + fetchLimit;
            try (var statement = connection.createStatement()) {
                statement.setMaxRows(fetchLimit);
                statement.setQueryTimeout(QUERY_TIMEOUT_SECONDS);
                try (var results = statement.executeQuery(executable)) {
                    var meta = results.getMetaData();
                    var columns = new ArrayList<String>(meta.getColumnCount());
                    for (var index = 1; index <= meta.getColumnCount(); index++) {
                        columns.add(meta.getColumnLabel(index));
                    }
                    var rows = new ArrayList<List<String>>();
                    var truncated = false;
                    while (results.next()) {
                        if (rows.size() >= effectiveMax) {
                            truncated = true;
                            break;
                        }
                        var row = new ArrayList<String>(columns.size());
                        for (var index = 1; index <= columns.size(); index++) {
                            row.add(cell(results, index));
                        }
                        rows.add(row);
                    }
                    return new QueryResultResponse(columns, rows, truncated);
                }
            }
        } catch (SQLException exception) {
            throw new InvalidRequestException("查询执行失败：" + ErrorMessages.safe(exception));
        }
    }

    /** 非注释内容必须以 SELECT/WITH 开头且为单条语句；分号仅允许出现在结尾。 */
    private void validateReadOnly(String inspectable) {
        var statement = inspectable.replaceAll(";\\s*$", "").trim();
        if (statement.isBlank()) {
            throw new InvalidRequestException("查询语句不能为空");
        }
        var lowered = statement.toLowerCase();
        if (!(lowered.startsWith("select") || lowered.startsWith("with"))) {
            throw new InvalidRequestException("仅支持只读查询（SELECT / WITH 开头）");
        }
        if (statement.indexOf(';') >= 0) {
            throw new InvalidRequestException("仅支持单条查询语句");
        }
    }

    private String stripComments(String sql) {
        var withoutBlock = BLOCK_COMMENT.matcher(sql).replaceAll(" ");
        return LINE_COMMENT.matcher(withoutBlock).replaceAll(" ").trim();
    }

    private boolean hasTrailingLimit(String inspectable) {
        return TRAILING_LIMIT.matcher(inspectable).find();
    }

    private int effectiveMaxRows(Integer requested) {
        if (requested == null) return DEFAULT_QUERY_MAX_ROWS;
        if (requested < 1) return 1;
        return Math.min(requested, HARD_QUERY_MAX_ROWS);
    }

    private Source requireJdbcSource(String sourceId) {
        var source = sourceService.require(sourceId);
        if (!"JDBC".equalsIgnoreCase(source.protocol())) {
            throw new InvalidRequestException("仅支持 JDBC 数据源的目录浏览与查询：" + source.protocol());
        }
        return source;
    }

    private Connection open(Source source) {
        var config = source.connection();
        if (config == null || config.isEmpty()) {
            throw new InvalidRequestException("数据源尚未登记连接配置，请先保存 jdbcUrl 与凭据引用后再浏览");
        }
        try {
            return connections.open(source, config);
        } catch (SourceConnections.ConnectionConfigurationException exception) {
            throw new InvalidRequestException(exception.getMessage());
        } catch (SQLException exception) {
            throw new InvalidRequestException("数据源连接失败：" + ErrorMessages.safe(exception));
        }
    }

    private String catalogPattern(String catalog) {
        return catalog == null || catalog.isBlank() ? null : catalog.trim();
    }

    private String remarks(String remark) {
        return remark == null ? "" : remark.trim();
    }

    /** 值统一转字符串防类型泄露；null 保持 null；二进制给占位说明不给内容。 */
    private String cell(ResultSet results, int index) throws SQLException {
        var value = results.getObject(index);
        if (value == null) return null;
        if (value instanceof byte[] bytes) {
            return "<" + bytes.length + " 字节二进制数据>";
        }
        return String.valueOf(value);
    }

    public record CatalogListResponse(List<String> catalogs, boolean truncated) {
    }

    public record TableSummary(String name, String type, String remark) {
    }

    public record TableListResponse(List<TableSummary> tables, boolean truncated) {
    }

    public record ColumnSummary(String name, String typeName, boolean nullable, String remark) {
    }

    public record ColumnListResponse(List<ColumnSummary> columns) {
    }

    public record QueryResultResponse(List<String> columns, List<List<String>> rows, boolean truncated) {
    }
}
