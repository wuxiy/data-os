# 真实质量执行器运行合同

`services/quality-runner` 是独立的 Python 3.12 Runtime，由控制面通过短时 OIDC
client-credentials 调用，任务由 DolphinScheduler/控制面编排，不在 Worker 中嵌入 dbt。
Runtime 只执行镜像内登记在 `rules.yml` 的 `dbt test --select`，不会接受 SQL、Shell、
上传项目或任意 CLI 参数。

## 请求与回写

```http
POST /api/v1/quality/runs
Authorization: Bearer <audience=dataos-quality-runner>
Idempotency-Key: <execution-batch-id>
Content-Type: application/json

{
  "issueId": "DQ-20260809-001",
  "tenantId": "hospital_a",
  "institutionId": "hospital_a_main",
  "title": "检验结果及时性下降",
  "ruleId": "rule-timeliness-result-time",
  "datasetId": "asset-lis-lab-result",
  "executionBatchId": "qr-20260809-001"
}
```

响应为 `202`，随后通过 `GET /api/v1/quality/runs/{runId}` 查询。状态会回写
`QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED`、通过/失败、执行批次、开始/结束时间、
脱敏样本证据和 RustFS/S3 汇总地址。数据库唯一键为 `(tenant_id, idempotency_key)`，
重试不会重复执行同一批次。

Runtime 使用 Postgres `FOR UPDATE SKIP LOCKED` 抢占队列：全局并发默认 2、单租户默认 1，
单次 dbt 最长 15 分钟；进程重启后超过心跳阈值的 RUNNING 任务回到 QUEUED。

## 状态与幂等契约

- 状态词汇为 `QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELED`（权威定义见仓库根
  `CONTEXT.md`「外部运行」）。控制面侧另有别名归一（`RunStatus.normalize`），
  执行器只回写上列五种。
- **执行批次号即运行主键，也即幂等键**：`executionBatchId` 同时充当 `runId`、
  `externalId` 与 `Idempotency-Key`。数据库唯一键 `(tenant_id, idempotency_key)`
  保证重投不重复执行；控制面重试同一批次得到同一 runId。
- 请求中的 `title`、`datasetId` 为控制面历史字段：执行器忽略（规则目录
  `rules.yml` 才是数据集映射的权威），模型不再声明。
- **两侧租约需协同调参**：执行器的 `QUALITY_RUNNER_STALE_RUN_SECONDS`（心跳
  失效后将 RUNNING 重排）必须大于单次执行的最长合理时长；控制面的
  `data-os.quality.submit-lease-ms`（提交租约）与轮询退避决定重投节奏。把一侧
  调小而不看另一侧，会打开重复执行窗口或让控制面提前放弃仍在执行的批次。

## 质量问题来源与治理闭环

生产不依赖 `DemoDataInitializer` 产生治理问题。经过审批的 DolphinScheduler/dbt 或院方质量
适配器在终态后调用控制面：

```http
POST /api/v1/governance/quality-findings
Authorization: Bearer <quality workflow token>
Content-Type: application/json

{
  "findingKey": "lis:result-timeliness",
  "sourceSystem": "dbt-quality",
  "tenantId": "hospital_a",
  "institutionId": "hospital_a_main",
  "title": "检验结果及时率下降",
  "severity": "HIGH",
  "datasetId": "asset-lis-lab-result",
  "ruleId": "rule-timeliness-result-time",
  "ownerDepartment": "检验科",
  "ownerId": "lab-data-admin",
  "ownerName": "检验科数据管理员",
  "ticketId": "TICKET-QUALITY-001",
  "impact": "检验主题 / 38 张表",
  "objectLabel": "检验结果",
  "executionBatchId": "quality-batch-001",
  "passed": false,
  "sampleEvidence": [{"record_id": "hmac-sha256:...", "status": "INVALID"}],
  "message": "发现不符合规则的记录"
}
```

`findingKey` 在 tenant/institution 内稳定，`executionBatchId` 标识一次执行；重复批次幂等，
失败结果创建或重新打开治理问题，成功结果关闭同一来源问题，并写入质量执行批次、事件和
责任人通知。`sampleEvidence` 必须已经由 Runtime 按规则列白名单脱敏，禁止上传患者姓名、
身份证号、原始 SQL、连接信息或凭据。生产调用需要 OIDC 的 `data-governance`/质量工作流
最小角色，不能通过任意 SQL 直接写治理表。

## Doris 与证据

业务库不由 Runtime 访问。Doris 质量查询账号只读验收/质量库；失败时仅执行固定的
`not_null`、`unique`、`accepted_values` 证据查询，最多 20 行；每条规则必须声明列级
allowlist 和 `IDENTIFIER/CATEGORY/SAFE/REDACTED` 分类。标识列使用由运行器主密钥按
tenant/institution 派生的专用 HMAC，
未登记列默认 `[REDACTED]`，不依赖字段名猜测 PHI。dbt `--store-failures` 产物在证据读取后
由单独清理账号按 tenant namespace + 注册 selector 删除，禁止通配表删除；超时、取消和 Runtime 重启也会
在 finally/启动清理残留。汇总 JSON 不包含 SQL、连接串或原始 PHI，RustFS/S3 制品默认保留 30 天。
部署时用 `DORIS_AUDIT_DATABASE` 指定隔离审计库；`DORIS_DBT_USER` 只允许读取业务库并
写入该审计库，`DORIS_CLEANUP_USER` 只允许删除已登记的失败表，不能把三类账号合并。

## 认证与租户

生产必须 `QUALITY_RUNNER_AUTH_MODE=ENFORCED`，JWT 校验 issuer、audience、`exp/iat/sub`、
JWKS，并要求 `tenant_id`、`institution_id` 与 `quality:submit/read` scope。控制面只保存
client secret，不向前端暴露。`DISABLED` 仅可用于开发接收器，使用通配租户 principal，
生产配置会在启动时失败。

## 注册规则

新增医疗规则必须同时提交：规则 ID、稳定 dbt selector、数据集 ID、证据查询合同、Doris
样本/真实表映射和测试。镜像构建时固定 `dbt-core` 与 `dbt-doris` 版本；运行时不联网拉取
Git 项目或包。首版 `rule-timeliness-result-time` 等兼容绑定只指向合成
`dataos_quality_acceptance.quality_sample`，真实 LIS/EMR/手术表接入前必须完成规则映射评审。
完成真实表映射后，应由调度工作流在质量检查终态调用上述 finding 接口；没有这一步，质量
执行结果不会自动出现在治理驾驶舱。
