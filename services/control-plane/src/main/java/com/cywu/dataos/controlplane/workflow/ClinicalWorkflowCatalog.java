package com.cywu.dataos.controlplane.workflow;

import java.util.List;
import java.util.Locale;
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
    public static final String LIS_HTTP_TO_DORIS = "LIS_HTTP_TO_DORIS";
    public static final String EMR_JDBC_TO_DORIS = "EMR_JDBC_TO_DORIS";
    public static final String SURGERY_JDBC_TO_DORIS = "SURGERY_JDBC_TO_DORIS";
    public static final String EP_JDBC_TO_DORIS = "EP_JDBC_TO_DORIS";
    public static final String EP_EDGE_S3_TO_DORIS = "EP_EDGE_S3_TO_DORIS";
    public static final int VERSION = 1;

    private final List<ClinicalWorkflowTemplate> templates = List.of(
            template(LIS_JDBC_TO_DORIS, "LIS 检验结果入仓", "LIS",
                    "检验结果、检验报告和危急值按更新时间增量采集到 ODS/LIS。",
                    "lis-laboratory-readonly", "ods_lis", "lab_result"),
            httpTemplate(LIS_HTTP_TO_DORIS, "LIS HTTP 回放入仓", "LIS",
                    "适用于前置机或院内 HTTP API 的脱敏回放/增量采集，按 since 参数读取结果。",
                    "lis-http-readonly", "ods_lis", "lab_result"),
            template(EMR_JDBC_TO_DORIS, "EMR 病历入仓", "EMR",
                    "门诊/住院病历按业务主键和更新时间批量或增量采集到 ODS/EMR。",
                    "emr-clinical-readonly", "ods_emr", "clinical_record"),
        template(SURGERY_JDBC_TO_DORIS, "手术系统记录入仓", "SURGERY",
                "手术申请、排程、麻醉和术后记录按更新时间增量采集到 ODS/手术。",
                "surgery-clinical-readonly", "ods_surgery", "operation_record"),
        template(EP_JDBC_TO_DORIS, "电子处方入仓", "EP",
                "门诊处方主表与药品处方明细按更新时间批量或增量采集到 ODS/EP。",
                "ep-dm-readonly", "ods_ep", "ep_mz_cfzb"),
        edgeTemplate(EP_EDGE_S3_TO_DORIS, "电子处方边缘中转入仓", "EP",
                "前置机投递到对象存储中转桶的电子处方增量文件，按 JSON 行入仓到 ODS/EP 边缘表（UNIQUE KEY 幂等重放）。",
                "ep-edge-s3-relay", "ods_ep", "ep_mz_cfzb_edge"));

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
        var edgeSource = EP_EDGE_S3_TO_DORIS.equalsIgnoreCase(key);
        var httpSource = LIS_HTTP_TO_DORIS.equalsIgnoreCase(key);
        requirePlugin(config, "source", edgeSource ? "S3File" : httpSource ? "Http" : "Jdbc",
                edgeSource ? "边缘中转工作流的 source 必须使用 S3File 连接器"
                        : httpSource ? "LIS HTTP 工作流的 source 必须使用 Http 连接器"
                        : "临床工作流的 source 必须使用 Jdbc 连接器");
        requirePlugin(config, "sink", "Doris", "临床工作流的 sink 必须使用 Doris 连接器");
        requireCredentialRef(config, "source");
        requireCredentialRef(config, "sink");
        var source = firstPlugin(config, "source");
        var sink = firstPlugin(config, "sink");
        if (edgeSource) {
            requireText(source, "path", "边缘中转工作流 source.path 不能为空");
            requireText(source, "bucket", "边缘中转工作流 source.bucket 不能为空");
            if (!String.valueOf(source.get("bucket")).trim().startsWith("s3a://")) {
                throw new InvalidRequestException("边缘中转工作流 source.bucket 必须以 s3a:// 开头（S3A 实现的选中条件）");
            }
            requireText(source, "fs.s3a.endpoint", "边缘中转工作流 source.fs.s3a.endpoint 不能为空");
            requireText(source, "file_format_type", "边缘中转工作流 source.file_format_type 不能为空");
        } else if (httpSource) {
            requireText(source, "url", "临床工作流 source.url 不能为空");
            requireText(source, "method", "LIS HTTP 工作流的 source.method 不能为空");
            requireText(source, "format", "LIS HTTP 工作流的 source.format 不能为空");
        } else {
            requireText(source, "url", "临床工作流 source.url 不能为空");
            requireText(source, "driver", "临床工作流 source.driver 不能为空");
            requireText(source, "query", "临床工作流 source.query 不能为空");
        }
        requireText(sink, "fenodes", "临床工作流 sink.fenodes 不能为空");
        requireText(sink, "database", "临床工作流 sink.database 不能为空");
        requireText(sink, "table", "临床工作流 sink.table 不能为空");
        requireText(sink, "sink.label-prefix", "临床工作流 sink.label-prefix 不能为空");
        requireBoolean(sink, "sink.enable-2pc", "临床工作流 sink.enable-2pc 必须明确配置");
        requireText(sink, "schema_save_mode", "临床工作流 schema_save_mode 不能为空");
        requireText(sink, "data_save_mode", "临床工作流 data_save_mode 不能为空");
        if (!(sink.get("doris.config") instanceof Map<?, ?> dorisConfig) || dorisConfig.isEmpty()) {
            throw new InvalidRequestException("临床工作流 doris.config 必须配置");
        }
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
                "query", "SELECT * FROM <replace-with-source-table> WHERE update_time >= '${last_success_time}' AND update_time < '${run_start_time}'",
                "credentialRef", "<replace-with-source-credential-id>");
        return new ClinicalWorkflowTemplate(key, VERSION, displayName, systemType, "JDBC", "SEATUNNEL",
                "BATCH", description, List.of(credentialRole, "doris-ods-writer"),
                Map.of("env", Map.of("job.mode", "BATCH", "parallelism", 1),
                        "source", List.of(source), "transform", List.of(), "sink", List.of(dorisSink(key, database, table))));
    }

    private ClinicalWorkflowTemplate httpTemplate(String key, String displayName, String systemType,
                                                   String description, String credentialRole,
                                                   String database, String table) {
        var source = Map.<String, Object>of(
                "plugin_name", "Http",
                "url", "https://<replace-with-lis-api-host>/api/lab/results?since=${last_success_time}&until=${run_start_time}",
                "method", "GET",
                "format", "JSON",
                "credentialRef", "<replace-with-source-credential-id>");
        return new ClinicalWorkflowTemplate(key, VERSION, displayName, systemType, "HTTP", "SEATUNNEL",
                "BATCH", description, List.of(credentialRole, "doris-ods-writer"),
                Map.of("env", Map.of("job.mode", "BATCH", "parallelism", 1),
                        "source", List.of(source), "transform", List.of(), "sink", List.of(dorisSink(key, database, table))));
    }

    private ClinicalWorkflowTemplate edgeTemplate(String key, String displayName, String systemType,
                                                  String description, String credentialRole,
                                                  String database, String table) {
        var source = Map.<String, Object>ofEntries(
                Map.entry("plugin_name", "S3File"),
                // SeaTunnel 2.3.13 S3File 语义（已对 RustFS 实测）：bucket 携带
                // s3a:// 前缀才会走 S3A 实现；path 必须是桶内绝对路径；格式
                // 选项是 file_format_type；附加 hadoop 属性走 hadoop_s3_properties。
                Map.entry("path", "/<replace-with-table-prefix>/"),
                Map.entry("bucket", "s3a://<replace-with-relay-bucket>"),
                Map.entry("fs.s3a.endpoint", "http://<replace-with-rustfs-host>:9000"),
                // 内层引号是必须的：控制面按 JSON 提交，枚举值需以带引号字面量
                // 抵达 SeaTunnel 的 HOCON 解析（实测无引号会被当裸 token 拒绝）。
                Map.entry("fs.s3a.aws.credentials.provider", "\"SimpleAWSCredentialsProvider\""),
                Map.entry("hadoop_s3_properties", Map.of(
                        "fs.s3a.path.style.access", "true",
                        "fs.s3a.connection.ssl.enabled", "false")),
                Map.entry("file_format_type", "json"),
                // The credential service stores the relay bucket key pair; the
                // access_key / secret_key entries it resolves are merged into
                // this map only in memory at submission time, so persisted job
                // configurations keep holding references alone.
                Map.entry("credentialRef", "<replace-with-edge-relay-credential-id>"));
        return new ClinicalWorkflowTemplate(key, VERSION, displayName, systemType, "S3", "SEATUNNEL",
                "BATCH", description, List.of(credentialRole, "doris-ods-writer"),
                Map.of("env", Map.of("job.mode", "BATCH", "parallelism", 1),
                        "source", List.of(source), "transform", List.of(), "sink", List.of(dorisSink(key, database, table))));
    }

    private Map<String, Object> dorisSink(String key, String database, String table) {
        // SeaTunnel 2.3.x requires a stream-load label prefix and
        // doris.config map. The target table's UNIQUE KEY model, not
        // an invented save_mode property, provides the UPSERT
        // semantics for reruns.
        return Map.<String, Object>ofEntries(
                Map.entry("plugin_name", "Doris"),
                Map.entry("fenodes", "<replace-with-doris-fe-host>:8030"),
                Map.entry("database", database),
                Map.entry("table", table),
                Map.entry("sink.label-prefix", "dataos_" + key.toLowerCase(Locale.ROOT)),
                Map.entry("sink.enable-2pc", false),
                Map.entry("schema_save_mode", "CREATE_SCHEMA_WHEN_NOT_EXIST"),
                Map.entry("data_save_mode", "APPEND_DATA"),
                Map.entry("doris.config", Map.of("format", "json", "read_json_by_line", "true")),
                Map.entry("credentialRef", "<replace-with-target-credential-id>"));
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

    private void requireBoolean(Map<String, Object> plugin, String key, String message) {
        if (!(plugin.get(key) instanceof Boolean)) throw new InvalidRequestException(message);
    }

    private boolean isPlaceholder(String value) {
        return value.contains("<replace-with-");
    }
}
