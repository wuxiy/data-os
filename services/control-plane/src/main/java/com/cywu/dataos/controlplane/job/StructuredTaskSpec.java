package com.cywu.dataos.controlplane.job;

import java.util.List;
import java.util.Map;

/**
 * 结构化采集任务意图（G2G 批次 1 第二刀）：门户只提交这份表单形态的声明，
 * 服务端编译为对接外部执行器的作业配置（单一属主 {@link StructuredTaskCompiler}）。
 *
 * <ul>
 *   <li>TABLE 形态：catalog + tables（多表共享增量与目标设置，每表一个作业）+
 *       columns 白名单（空 = 全列）+ orderKey 序列键（增量方式要求时间类型）；</li>
 *   <li>SQL 形态：customSql 只读语句（保存前经源上只读校验），目标表显式命名。</li>
 * </ul>
 */
public record StructuredTaskSpec(
        String form,
        String sourceId,
        String catalog,
        List<String> tables,
        List<String> columns,
        String orderKey,
        String mode,
        String customSql,
        String targetDatabase,
        String targetTable,
        String sinkFenodes,
        String sinkCredentialRef) {

    public static final String FORM_TABLE = "TABLE";
    public static final String FORM_SQL = "SQL";
    public static final String MODE_FULL = "FULL";
    public static final String MODE_INCREMENTAL = "INCREMENTAL";

    public StructuredTaskSpec {
        form = form == null ? "" : form.trim().toUpperCase();
        sourceId = sourceId == null ? "" : sourceId.trim();
        catalog = catalog == null ? "" : catalog.trim();
        tables = tables == null ? List.of() : List.copyOf(tables);
        columns = columns == null ? List.of() : List.copyOf(columns);
        orderKey = orderKey == null ? "" : orderKey.trim();
        mode = mode == null ? "" : mode.trim().toUpperCase();
        customSql = customSql == null ? "" : customSql.trim();
        targetDatabase = targetDatabase == null ? "" : targetDatabase.trim().toLowerCase();
        targetTable = targetTable == null ? "" : targetTable.trim();
        sinkFenodes = sinkFenodes == null ? "" : sinkFenodes.trim();
        sinkCredentialRef = sinkCredentialRef == null ? "" : sinkCredentialRef.trim();
    }

    /** 从落库 JSON 反序列化后的宽松读取（未知键忽略、缺键置空）。 */
    public static StructuredTaskSpec fromMap(Map<String, Object> value) {
        if (value == null) return null;
        return new StructuredTaskSpec(
                text(value.get("form")),
                text(value.get("sourceId")),
                text(value.get("catalog")),
                value.get("tables") instanceof List<?> list ? list.stream().map(StructuredTaskSpec::text).toList() : List.of(),
                value.get("columns") instanceof List<?> list ? list.stream().map(StructuredTaskSpec::text).toList() : List.of(),
                text(value.get("orderKey")),
                text(value.get("mode")),
                text(value.get("customSql")),
                text(value.get("targetDatabase")),
                text(value.get("targetTable")),
                text(value.get("sinkFenodes")),
                text(value.get("sinkCredentialRef")));
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    /** 落库形态（键序稳定，structured_json 用）。 */
    public Map<String, Object> toMap() {
        var result = new java.util.LinkedHashMap<String, Object>();
        result.put("form", form);
        result.put("sourceId", sourceId);
        result.put("catalog", catalog);
        result.put("tables", tables);
        result.put("columns", columns);
        result.put("orderKey", orderKey);
        result.put("mode", mode);
        if (!customSql.isBlank()) result.put("customSql", customSql);
        result.put("targetDatabase", targetDatabase);
        result.put("targetTable", targetTable);
        result.put("sinkFenodes", sinkFenodes);
        result.put("sinkCredentialRef", sinkCredentialRef);
        return result;
    }
}
