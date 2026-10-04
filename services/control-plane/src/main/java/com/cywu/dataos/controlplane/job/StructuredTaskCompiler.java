package com.cywu.dataos.controlplane.job;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.source.Source;
import com.cywu.dataos.controlplane.source.SourceExplorerService;
import com.cywu.dataos.controlplane.source.SourceService;
import org.springframework.stereotype.Component;

/**
 * 结构化任务意图 → 外部执行器作业配置的编译器（G2G 批次 1 第二刀）。
 *
 * <p>编译产物沿用临床工作流模板的既定形状：env{job.mode,parallelism} +
 * source[Jdbc]{url,driver,query,credentialRef,partition_column?} + sink[Doris]。
 * 源连接取自数据源上登记的非敏感连接配置（第一刀 connection_json）——url 与
 * credentialRef 都不再由任务侧重复填写。保存前的实校验（表存在、白名单列存在、
 * 序列键为时间类型、SQL 只读）全部经 {@link SourceExplorerService} 对着真实
 * 目录元数据执行。
 */
@Component
public class StructuredTaskCompiler {

    public static final String TEMPLATE_KEY = "STRUCTURED_JDBC_TO_DORIS";
    public static final int TEMPLATE_VERSION = 1;

    /** 元数据列名/表名只允许普通标识符字符；含特殊字符的列请改用 SQL 形态。 */
    private static final Pattern IDENTIFIER = Pattern.compile("[A-Za-z0-9_$]+");

    private final SourceService sourceService;
    private final SourceExplorerService explorer;

    public StructuredTaskCompiler(SourceService sourceService, SourceExplorerService explorer) {
        this.sourceService = sourceService;
        this.explorer = explorer;
    }

    /** 校验意图并对着源目录实校验；返回归一化后的意图（落 structured_json 用）。 */
    public StructuredTaskSpec validate(StructuredTaskSpec spec) {
        var source = requireConnectedSource(spec.sourceId());
        var form = spec.form();
        if (!(StructuredTaskSpec.FORM_TABLE.equals(form) || StructuredTaskSpec.FORM_SQL.equals(form))) {
            throw new InvalidRequestException("结构化任务形态必须是 TABLE 或 SQL");
        }
        requireIdentifier(spec.targetDatabase().isBlank()
                ? defaultTargetDatabase(source) : spec.targetDatabase(), "目标库");
        if (form.equals(StructuredTaskSpec.FORM_SQL)) {
            if (spec.customSql().isBlank()) throw new InvalidRequestException("SQL 形态任务需要填写查询语句");
            explorer.assertReadOnlyQuery(spec.customSql());
            if (spec.targetTable().isBlank()) throw new InvalidRequestException("SQL 形态任务需要指定目标表名");
            requireIdentifier(spec.targetTable(), "目标表");
        } else {
            if (spec.tables().size() != 1) {
                throw new InvalidRequestException("结构化任务一次保存一张表；多表请逐张保存");
            }
            requireIdentifier(spec.tables().get(0), "源表");
            requireIdentifier(spec.targetTable().isBlank() ? spec.tables().get(0) : spec.targetTable(), "目标表");
        }
        requireSinkFields(spec);
        if (spec.mode().isBlank()) throw new InvalidRequestException("采集方式不能为空");
        if (!(StructuredTaskSpec.MODE_FULL.equals(spec.mode())
                || StructuredTaskSpec.MODE_INCREMENTAL.equals(spec.mode()))) {
            throw new InvalidRequestException("采集方式必须是 FULL 或 INCREMENTAL");
        }
        if (StructuredTaskSpec.MODE_INCREMENTAL.equals(spec.mode())) {
            if (spec.orderKey().isBlank()) throw new InvalidRequestException("增量方式需要选择序列键");
            requireIdentifier(spec.orderKey(), "序列键");
        }
        var table = form.equals(StructuredTaskSpec.FORM_TABLE) ? spec.tables().get(0) : null;
        var columns = table == null ? List.<String>of() : validateColumnsAgainstSource(spec, table);
        if (table != null && !columns.isEmpty() && !columns.contains(spec.orderKey())
                && StructuredTaskSpec.MODE_INCREMENTAL.equals(spec.mode())) {
            // 白名单缺序列键时增量 WHERE 引用不存在的投影列，直接补入并如实落库。
            var extended = new ArrayList<>(columns);
            extended.add(spec.orderKey());
            columns = List.copyOf(extended);
        }
        return new StructuredTaskSpec(form, spec.sourceId(), spec.catalog(), spec.tables(),
                columns, spec.orderKey(), spec.mode(), spec.customSql(),
                spec.targetDatabase().isBlank() ? defaultTargetDatabase(source) : spec.targetDatabase(),
                spec.targetTable().isBlank() && table != null ? table : spec.targetTable(),
                spec.sinkFenodes(), spec.sinkCredentialRef());
    }

    /** 编译为作业配置（调用前必须已 {@link #validate}；jobId 决定 label-prefix 稳定性）。 */
    public Map<String, Object> compile(StructuredTaskSpec normalized, String jobId) {
        var source = requireConnectedSource(normalized.sourceId());
        var sourcePlugin = new LinkedHashMap<String, Object>();
        sourcePlugin.put("plugin_name", "Jdbc");
        sourcePlugin.put("url", source.connection().get("jdbcUrl"));
        sourcePlugin.put("driver", driverFor(String.valueOf(source.connection().get("jdbcUrl"))));
        sourcePlugin.put("query", compileQuery(normalized));
        if (StructuredTaskSpec.FORM_TABLE.equals(normalized.form())
                && StructuredTaskSpec.MODE_INCREMENTAL.equals(normalized.mode())) {
            sourcePlugin.put("partition_column", normalized.orderKey());
        }
        sourcePlugin.put("credentialRef", source.connection().get("credentialRef"));

        var sink = new LinkedHashMap<String, Object>();
        sink.put("plugin_name", "Doris");
        sink.put("fenodes", normalized.sinkFenodes());
        sink.put("database", normalized.targetDatabase());
        sink.put("table", normalized.targetTable());
        sink.put("sink.label-prefix", "dataos_job_" + jobId.toLowerCase(Locale.ROOT).replace("-", ""));
        sink.put("sink.enable-2pc", false);
        sink.put("schema_save_mode", "CREATE_SCHEMA_WHEN_NOT_EXIST");
        sink.put("data_save_mode", "APPEND_DATA");
        sink.put("doris.config", Map.of("format", "json", "read_json_by_line", "true"));
        sink.put("credentialRef", normalized.sinkCredentialRef());

        return Map.of(
                "env", Map.of("job.mode", "BATCH", "parallelism", 1),
                "source", List.of(sourcePlugin),
                "transform", List.of(),
                "sink", List.of(sink));
    }

    private String compileQuery(StructuredTaskSpec spec) {
        var projection = spec.columns().isEmpty() ? "*" : String.join(", ", spec.columns());
        if (StructuredTaskSpec.FORM_SQL.equals(spec.form())) {
            return spec.customSql();
        }
        var table = spec.tables().get(0);
        if (StructuredTaskSpec.MODE_INCREMENTAL.equals(spec.mode())) {
            return "SELECT " + projection + " FROM " + table
                    + " WHERE " + spec.orderKey() + " >= '${last_success_time}'"
                    + " AND " + spec.orderKey() + " < '${run_start_time}'";
        }
        return "SELECT " + projection + " FROM " + table;
    }

    /** 白名单逐列对着源目录实校验；返回按元数据顺序排列的列清单。 */
    private List<String> validateColumnsAgainstSource(StructuredTaskSpec spec, String table) {
        var response = explorer.columns(spec.sourceId(), spec.catalog(), table);
        var metadata = new LinkedHashMap<String, String>();
        for (var column : response.columns()) {
            metadata.put(column.name(), column.typeName());
        }
        if (metadata.isEmpty()) {
            throw new InvalidRequestException("源目录中未找到该表：" + table + "（库：" + spec.catalog() + "）");
        }
        var ordered = new ArrayList<String>();
        for (var requested : spec.columns()) {
            if (!metadata.containsKey(requested)) {
                throw new InvalidRequestException("字段白名单中的列不存在于源表：" + requested);
            }
            ordered.add(requested);
        }
        if (StructuredTaskSpec.MODE_INCREMENTAL.equals(spec.mode())) {
            var typeName = metadata.get(spec.orderKey());
            if (typeName == null) {
                throw new InvalidRequestException("序列键不存在于源表：" + spec.orderKey());
            }
            var upper = typeName.toUpperCase(Locale.ROOT);
            if (!(upper.contains("DATE") || upper.contains("TIMESTAMP"))) {
                throw new InvalidRequestException("增量方式要求序列键为时间类型（DATE/DATETIME/TIMESTAMP），当前："
                        + typeName + "。整数序列键请改用全量 + 幂等唯一键目标模型");
            }
        }
        return List.copyOf(ordered);
    }

    private Source requireConnectedSource(String sourceId) {
        var source = sourceService.require(sourceId);
        if (!"JDBC".equalsIgnoreCase(source.protocol())) {
            throw new InvalidRequestException("结构化任务仅支持 JDBC 数据源：" + source.protocol());
        }
        var connection = source.connection();
        if (connection == null || connection.isEmpty()) {
            throw new InvalidRequestException("数据源尚未登记连接配置，请先在数据源浏览中保存连接参数");
        }
        var credentialRef = String.valueOf(connection.getOrDefault("credentialRef", "")).trim();
        if (credentialRef.isBlank()) {
            throw new InvalidRequestException("结构化任务要求源连接登记 credentialRef（外部执行器不接收内联账号）");
        }
        return source;
    }

    private void requireSinkFields(StructuredTaskSpec spec) {
        if (spec.sinkFenodes().isBlank()) throw new InvalidRequestException("目标仓库 FE 地址不能为空（例如 fe-host:8030）");
        if (spec.sinkCredentialRef().isBlank()) throw new InvalidRequestException("目标仓库凭据引用不能为空");
    }

    private String defaultTargetDatabase(Source source) {
        return "ods_" + source.systemType().toLowerCase(Locale.ROOT);
    }

    private void requireIdentifier(String value, String label) {
        if (value.isBlank() || !IDENTIFIER.matcher(value).matches()) {
            throw new InvalidRequestException(label + "只能是字母数字下划线组成的标识符：" + value);
        }
    }

    private String driverFor(String jdbcUrl) {
        var lower = jdbcUrl.toLowerCase(Locale.ROOT);
        if (lower.startsWith("jdbc:postgresql:")) return "org.postgresql.Driver";
        if (lower.startsWith("jdbc:mysql:")) return "com.mysql.cj.jdbc.Driver";
        if (lower.startsWith("jdbc:sqlserver:")) return "com.microsoft.sqlserver.jdbc.SQLServerDriver";
        if (lower.startsWith("jdbc:oracle:")) return "oracle.jdbc.driver.OracleDriver";
        if (lower.startsWith("jdbc:dm:")) return "dm.jdbc.driver.DmDriver";
        if (lower.startsWith("jdbc:h2:")) return "org.h2.Driver";
        var hint = jdbcUrl.length() > 80 ? jdbcUrl.substring(0, 80) + "…" : jdbcUrl;
        throw new InvalidRequestException("无法从 JDBC URL 推断驱动类：" + hint);
    }
}
