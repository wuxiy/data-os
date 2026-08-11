# 临床采集工作流合同

本目录定义 data-os 首批可交付的 LIS、EMR、手术系统采集合同。合同由控制面接口
`GET /api/v1/workflow-templates` 暴露，门户的数据接入页直接消费，不要求业务人员手写
SeaTunnel 文件。合同是版本化的配置边界，不表示目标医院的端点和账号已经就绪。

## 首批模板

| 模板 | 来源系统 | 执行器 | 目标 | 默认语义 |
| --- | --- | --- | --- | --- |
| `LIS_JDBC_TO_DORIS` v1 | LIS 检验系统 | SeaTunnel | `ods_lis.lab_result` | 按 `update_time` 增量 |
| `LIS_HTTP_TO_DORIS` v1 | LIS HTTP/前置机回放 | SeaTunnel | `ods_lis.lab_result` | 按 `since` 水位读取 JSON |
| `EMR_JDBC_TO_DORIS` v1 | EMR 病历系统 | SeaTunnel | `ods_emr.clinical_record` | 业务主键 + 更新时间 |
| `SURGERY_JDBC_TO_DORIS` v1 | 手术/麻醉系统 | SeaTunnel | `ods_surgery.operation_record` | 排程、麻醉、术后记录增量 |

JDBC 模板要求：

- `source[0].plugin_name=Jdbc`，`sink[0].plugin_name=Doris`；
- source 使用院内只读 JDBC URL、查询和 `credentialRef`；
- sink 使用平台 Doris FE、库表和写入 `credentialRef`；
- 密码、Token、Secret 不得出现在任务 JSON、日志或前端响应中；
- 连接器提交前由控制面按当前 OIDC 的 tenant/institution 解析凭据，解析失败即阻断运行。

`LIS_HTTP_TO_DORIS` 使用 `Http` source、`GET`、JSON 响应和 `credentialRef`；前置机回放
fixture 位于 [`deploy/dev/replay-source`](../deploy/dev/replay-source/README.md)，生产端点、
分页、签名和字段映射必须由院方交接后替换并重新验收。

## 最小配置形状

门户选择模板时会带出以下无密钥样例。实施人员只需替换尖括号字段并先在凭据中心创建引用：

```json
{
  "env": { "job.mode": "BATCH", "parallelism": 1 },
  "source": [{
    "plugin_name": "Jdbc",
    "url": "jdbc:postgresql://<lis-or-emr-or-surgery-host>:5432/<database>",
    "driver": "org.postgresql.Driver",
    "query": "SELECT * FROM <source_table> WHERE update_time >= '${last_success_time}' AND update_time < '${run_start_time}'",
    "credentialRef": "<source-credential-id>"
  }],
  "transform": [],
  "sink": [{
    "plugin_name": "Doris",
    "fenodes": "<doris-fe-host>:8030",
    "database": "ods_lis",
    "table": "lab_result",
    "sink.label-prefix": "dataos_lis_jdbc_to_doris",
    "sink.enable-2pc": false,
    "schema_save_mode": "CREATE_SCHEMA_WHEN_NOT_EXIST",
    "data_save_mode": "APPEND_DATA",
    "doris.config": {"format": "json", "read_json_by_line": "true"},
    "credentialRef": "<doris-writer-credential-id>"
  }]
}
```

`<source-credential-id>` 和 `<doris-writer-credential-id>` 只是文档占位符，不能直接保存。
控制面会拒绝仍带 `<replace-with-...>` 或空引用的临床模板。

查询中的 `${last_success_time}` 由控制面从 `data_os.ingestion_checkpoints` 注入；首次运行使用
`1970-01-01T00:00:00Z`。`${run_start_time}` 是采集提交前捕获的上界，只有目标执行器回写
`SUCCEEDED` 后才将该上界推进为作业水位，避免慢查询期间新提交的记录被跳过。重复投递携带稳定
`dataos_run_id`，提交前崩溃的 `SUBMITTING` 记录按租约转为可重试的阻塞状态。平台仍只承诺
at-least-once：失败批次通过同一作业的重试/回放重新执行，目标 Doris ODS 必须使用 UNIQUE KEY/UPSERT，
不宣称跨 SeaTunnel、源库和 Doris 的 exactly-once。

`connector-doris` 的 2.3.x 合同要求 `sink.label-prefix` 和 `doris.config`；批量重跑
的幂等/UPSERT 由目标 Doris ODS 表的 UNIQUE KEY/主键设计和平台批次策略共同保证，
不是通过一个并不存在的通用 `save_mode=UPSERT` 参数保证。目标表建模、迟到数据和
重复批次策略必须在院方验收时固化。

## 启用前置条件

1. 甲方提供脱敏字段字典、增量水位字段、主键/唯一键和一条可回放的样本查询。
2. 在对应 tenant/institution 下创建最小权限的源库只读凭据和 Doris 写入凭据。
3. 完成数据源连通性检查、目标 Doris ODS 表建表、字段类型映射和重复/迟到数据策略确认。
4. 先以小窗口运行并检查行数、批次号和质量规则，再启用计划任务。
5. 需要 DolphinScheduler 计划或补数时，仅绑定已审核的命名租户工作流；不恢复历史隔离 Shell 工作流。

开发机当前没有真实 LIS、EMR、手术系统主机、账号或院方脱敏样本，因此本版本只完成合同、凭据解析、
HTTP 回放和阻断校验，不能把模板列表或 SeaTunnel 健康检查报告为真实医院业务数据已接入。
