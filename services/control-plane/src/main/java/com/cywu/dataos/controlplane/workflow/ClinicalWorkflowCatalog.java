package com.cywu.dataos.controlplane.workflow;

import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import org.springframework.stereotype.Component;

/**
 * Keeps the first clinical connector contracts in one small, reviewable
 * catalog. The catalog is not a second scheduler: it only describes the
 * supported source/sink shape that SeaTunnel executes.
 */
@Component
public final class ClinicalWorkflowCatalog {

    public static final String LIS_JDBC_TO_DORIS = "LIS_JDBC_TO_DORIS";
    public static final String EMR_JDBC_TO_DORIS = "EMR_JDBC_TO_DORIS";
    public static final String SURGERY_JDBC_TO_DORIS = "SURGERY_JDBC_TO_DORIS";
    public static final int VERSION = 1;

    private final List<ClinicalWorkflowTemplate> templates = List.of(
            template(LIS_JDBC_TO_DORIS, "LIS 检验结果入仓", "LIS",
                    "检验结果、检验报告和危急值按更新时间增量采集到 ODS/LIS。",
                    "lis-laboratory-readonly", "ods_lis", "lab_result"),
            template(EMR_JDBC_TO_DORIS, "EMR 病历入仓", "EMR",
                    "门诊/住院病历按业务主键和更新时间批量或增量采集到 ODS/EMR。",
                    "emr-clinical-readonly", "ods_emr", "clinical_record"),
            template(SURGERY_JDBC_TO_DORIS, "手术系统记录入仓", "SURGERY",
                    "手术申请、排程、麻醉和术后记录按更新时间增量采集到 ODS/手术。",
                    "surgery-clinical-readonly", "ods_surgery", "operation_record"));

    public List<ClinicalWorkflowTemplate> list() {
        return templates;
    }

    public boolean supports(String key) {
        return find(key).isPresent();
    }

    public ClinicalWorkflowTemplate require(String key, Integer version) {
        var template = find(key).orElseThrow(() -> new InvalidRequestException("未知临床工作流模板：" + key));
        if (version == null || version != template.version()) {
            throw new InvalidRequestException("临床工作流模板版本不受支持：" + key + " v" + version);
        }
        return template;
    }

    /** Validate a saved configuration without resolving or exposing secrets. */
    public void validateConfig(String key, Integer version, Map<String, Object> config) {
        if (!supports(key)) return;
        require(key, version);
        requirePlugin(config, "source", "Jdbc", "临床工作流的 source 必须使用 Jdbc 连接器");
        requirePlugin(config, "sink", "Doris", "临床工作流的 sink 必须使用 Doris 连接器");
        requireCredentialRef(config, "source");
        requireCredentialRef(config, "sink");
        var source = firstPlugin(config, "source");
        var sink = firstPlugin(config, "sink");
        requireText(source, "url", "临床工作流 source.url 不能为空");
        requireText(source, "driver", "临床工作流 source.driver 不能为空");
        requireText(source, "query", "临床工作流 source.query 不能为空");
        requireText(sink, "fenodes", "临床工作流 sink.fenodes 不能为空");
        requireText(sink, "database", "临床工作流 sink.database 不能为空");
        requireText(sink, "table", "临床工作流 sink.table 不能为空");
    }

    private java.util.Optional<ClinicalWorkflowTemplate> find(String key) {
        if (key == null) return java.util.Optional.empty();
        return templates.stream().filter(item -> item.key().equalsIgnoreCase(key.trim())).findFirst();
    }

    private ClinicalWorkflowTemplate template(String key, String displayName, String systemType,
                                               String description, String credentialRole,
                                               String database, String table) {
        var source = Map.<String, Object>of(
                "plugin_name", "Jdbc",
                "url", "jdbc:<replace-with-lis-emr-surgery-host>:<port>/<database>",
                "driver", "<replace-with-jdbc-driver>",
                "query", "SELECT * FROM <replace-with-source-table> WHERE update_time >= '${last_success_time}'",
                "credentialRef", "<replace-with-source-credential-id>");
        var sink = Map.<String, Object>of(
                "plugin_name", "Doris",
                "fenodes", "<replace-with-doris-fe-host>:8030",
                "database", database,
                "table", table,
                "save_mode", "UPSERT",
                "credentialRef", "<replace-with-target-credential-id>");
        return new ClinicalWorkflowTemplate(key, VERSION, displayName, systemType, "JDBC", "SEATUNNEL",
                "BATCH", description, List.of(credentialRole, "doris-ods-writer"),
                Map.of("env", Map.of("job.mode", "BATCH", "parallelism", 1),
                        "source", List.of(source), "transform", List.of(), "sink", List.of(sink)));
    }

    private void requirePlugin(Map<String, Object> config, String section, String expected, String message) {
        var plugin = firstPlugin(config, section);
        var actual = String.valueOf(plugin.getOrDefault("plugin_name", ""));
        if (!expected.equalsIgnoreCase(actual)) throw new InvalidRequestException(message);
    }

    private void requireCredentialRef(Map<String, Object> config, String section) {
        var plugin = firstPlugin(config, section);
        var reference = String.valueOf(plugin.getOrDefault("credentialRef", "")).trim();
        if (reference.isBlank() || isPlaceholder(reference)) {
            throw new InvalidRequestException("临床工作流 " + section + " 必须配置有效 credentialRef");
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> firstPlugin(Map<String, Object> config, String section) {
        if (!(config.get(section) instanceof List<?> list) || list.isEmpty()
                || !(list.get(0) instanceof Map<?, ?> map)) {
            throw new InvalidRequestException("临床工作流必须包含非空 " + section + " 插件列表");
        }
        var result = new java.util.LinkedHashMap<String, Object>();
        map.forEach((key, value) -> result.put(String.valueOf(key), value));
        return result;
    }

    private void requireText(Map<String, Object> plugin, String key, String message) {
        var value = String.valueOf(plugin.getOrDefault(key, "")).trim();
        if (value.isBlank() || isPlaceholder(value)) throw new InvalidRequestException(message);
    }

    private boolean isPlaceholder(String value) {
        return value.contains("<replace-with-");
    }
}
