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

## Doris 与证据

业务库不由 Runtime 访问。Doris 质量查询账号只读验收/质量库；失败时仅执行固定的
`not_null`、`unique`、`accepted_values` 证据查询，最多 20 行，字段名命中患者/身份等
敏感模式时返回 SHA-256 前缀。dbt `--store-failures` 产物在证据读取后由单独清理账号
按精确注册 selector 删除，禁止通配表删除。汇总 JSON 不包含 SQL、连接串或原始 PHI。
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
