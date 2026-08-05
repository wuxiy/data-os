# data-os 开发环境部署

这套覆盖只新增 data-os 控制面、桌面门户和可选的 SeaTunnel 单节点执行器，不修改 data-ops 的 Compose 文件。PostgreSQL 复用 `medical-platform-keycloak-db-1`，通过 `data_os` schema 隔离表。

## 组件

| 服务 | 作用 | 暴露端口 |
| --- | --- | --- |
| `control-plane` | Java 21 / Spring Boot API，初始化 PostgreSQL schema | 仅平台网络 `8080` |
| `portal` | React/Vite 静态门户与 API 反向代理 | `18081` |
| `seatunnel-master` | SeaTunnel 单节点开发执行器，可选 profile | `18082`、`15801` |

## 启动

远程目录需要有以下文件：`docker-compose.yml`、`nginx.conf`、`seatunnel/seatunnel.yaml`、`portal-dist/` 和控制面镜像。不要把真实密码提交到仓库；运行时只在开发机的 `.env` 提供：

```dotenv
DATAOS_DB_PASSWORD=复用 keycloak-db 的数据库密码
DATAOS_SEED_DEMO=true
# 可选：控制面运行状态同步周期，单位毫秒
DATAOS_RUN_SYNC_INTERVAL_MS=30000
DATAOS_RUN_SYNC_INITIAL_DELAY_MS=10000
DATAOS_SEATUNNEL_TIME_ZONE=UTC
# 开发环境默认使用确定性的 DEMO 质量执行器；生产改为 HTTP/DBT 并配置执行器地址。
DATAOS_QUALITY_EXECUTOR=DEMO
DATAOS_QUALITY_EXECUTOR_BASE_URL=
DATAOS_QUALITY_SUBMIT_LEASE_MS=120000
DATAOS_QUALITY_DEMO_DELAY_MS=1500
# 可选：责任人 Webhook；为空时通知会记录为 SKIPPED，不会伪造已送达。
DATAOS_NOTIFICATION_WEBHOOK_URL=
DATAOS_NOTIFICATION_MAX_ATTEMPTS=5
DATAOS_NOTIFICATION_LEASE_MS=120000
```

先启动门户和控制面：

```bash
docker compose -f docker-compose.yml up -d control-plane portal
```

SeaTunnel 使用 Apache 2.3.13 二进制包构建本地开发镜像。Dockerfile 会在构建阶段下载并校验固定 SHA512，干净检出即可复现：

```bash
docker build \
  --build-arg SEATUNNEL_VERSION=2.3.13 \
  --build-arg SEATUNNEL_SHA512=499fc1926a7a6f771b1e4034b6d6a43af028984741ec7745a9f50505a267d7d6b35b164a56be957cb1b0b56afc34e68b917289025244cd86c49d48583cc617e7 \
  -t "${SEATUNNEL_IMAGE:-medical-platform/data-os-seatunnel:2.3.13-dev}" \
  seatunnel
```

运行时镜像默认是 `medical-platform/data-os-seatunnel:2.3.13-dev`；若已有合规镜像，可通过 `SEATUNNEL_IMAGE` 覆盖。使用已构建镜像时不需要 `--build`：

```bash
printf '\nSEATUNNEL_BASE_URL=http://seatunnel-master:8080\n' >> .env
docker compose -f docker-compose.yml --profile executor up -d seatunnel-master
```

SeaTunnel Zeta REST API 使用 `http://seatunnel-master:8080/submit-job`，控制面会将提交结果写入运行记录；`5801` 仅用于集群内部通信。

控制面后台按 `DATAOS_RUN_SYNC_INTERVAL_MS` 查询 `SUBMITTED/RUNNING` 运行记录，并调用 SeaTunnel `/job-info/{jobId}` 将 `FINISHED/FAILED/CANCELED` 等外部状态归一后回写。`startTime` 才会回填运行记录的实际启动时间；SeaTunnel 的 `createTime` 仅代表创建/提交时间，不会冒充 `started_at`。门户“数据接入 → 采集任务”可对仍在运行的记录点击“同步状态”，对应接口为：

```text
POST /api/v1/jobs/{jobId}/runs/{runId}/sync
```

`UNKNOWN` 记录不进入后台无限重试，但会阻止同一任务重复启动；业务人员可通过门户“同步状态”触发一次人工重试。`ingestion_jobs.status` 仍表示任务生命周期，最近一次执行结果以 `job_runs` 为准。

任务配置由控制面统一保存，门户不直接写 SeaTunnel 文件。创建任务时可同时提交 `templateKey`、`templateVersion` 和结构化 `config`；已有任务通过以下接口读取或更新：

```text
GET /api/v1/jobs/{jobId}/config
PUT /api/v1/jobs/{jobId}/config
```

`env`、`source`、`transform`、`sink` 是当前模板边界；`source` 和 `sink` 不能为空。配置递归检查 `password`、`secret` 和 `token` 等键，发现明文凭据会返回 `400 INVALID_REQUEST`，应改用后续凭据引用能力。运行请求体可以为空，控制面会使用已保存配置；门户每次启动发送新的 `Idempotency-Key`，网络重试使用同一个 key 且请求内容一致时只返回原运行记录，不会重复提交；同一个 key 搭配不同配置会返回 `409 CONFLICT`。

任务生命周期通过以下接口操作：

```text
PUT /api/v1/jobs/{jobId}/status
```

状态为 `DRAFT`、`ACTIVE`、`PAUSED`、`ARCHIVED`。`PAUSED` 和 `ARCHIVED` 会阻止新运行；失败、阻塞或取消的运行可通过以下接口创建一条新的重试记录，重试会重新读取任务已保存配置：

```text
POST /api/v1/jobs/{jobId}/runs/{runId}/retry
```

数据源登记后可通过以下接口进行可用性检查。检查配置只在本次请求中使用，不会落库；检查结果和最近检查时间会写回来源记录。当前实现支持 JDBC、HTTP/FHIR，SFTP 会明确返回待配置而不会伪造健康：

```text
POST /api/v1/sources/{sourceId}/check
```

JDBC 示例：

```json
{"config":{"jdbcUrl":"jdbc:postgresql://host:5432/db","username":"readonly"}}
```

HTTP/FHIR 示例：

```json
{"config":{"url":"http://edge-node:8080/health"}}
```

一条可验收的 FakeSource → Console 配置如下（仅用于执行器烟囱测试，不代表院内真实连接凭据）：

```json
{
  "env": {"job.mode": "BATCH", "parallelism": 1},
  "source": [{
    "plugin_name": "FakeSource",
    "plugin_output": "fake",
    "row.num": 16,
    "schema": {"fields": {"name": "string", "age": "int"}}
  }],
  "transform": [],
  "sink": [{"plugin_name": "Console", "plugin_input": ["fake"]}]
}
```

## 验收

```bash
curl -fsS http://127.0.0.1:18081/healthz
curl -fsS http://127.0.0.1:18081/api/v1/governance/summary
curl -fsS http://127.0.0.1:18081/api/v1/sources
curl -fsS http://127.0.0.1:18082/overview
# 查询某条运行记录（需先从 POST /api/v1/jobs/{jobId}/runs 获取 runId）
curl -fsS -X POST http://127.0.0.1:18081/api/v1/jobs/{jobId}/runs/{runId}/sync
# 用已保存任务配置启动，并用同一 key 重试验证幂等
curl -fsS -X POST http://127.0.0.1:18081/api/v1/jobs/{jobId}/runs \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: acceptance-run-1' -d '{}'
```

浏览器访问 `http://开发机地址:18081/`。治理驾驶舱顶部显示“控制面已连接”时，指标与问题来自复用 PostgreSQL 的 `data_os` schema；数据质量闭环页同样从 `governance_issues` 与 `governance_issue_events` 读取真实队列和处理记录。控制面不可用时，治理驾驶舱可保留指标降级标识，但数据接入和质量闭环不会展示演示业务数据，而是显示不可用空态。

质量问题闭环 API：

```bash
curl 'http://开发机地址:18081/api/v1/governance/issues?status=OVERDUE'
curl 'http://开发机地址:18081/api/v1/governance/issues/{issueId}'
curl -X PUT 'http://开发机地址:18081/api/v1/governance/issues/{issueId}/workflow' \
  -H 'Content-Type: application/json' \
  -d '{"status":"IN_PROGRESS","note":"已补齐接口数据，准备复检。"}'
curl -X POST 'http://开发机地址:18081/api/v1/governance/issues/{issueId}/recheck' \
  -H 'Content-Type: application/json' \
  -d '{"note":"按原质量规则重新执行复检"}'
curl -X POST 'http://开发机地址:18081/api/v1/governance/issues/{issueId}/runs/{runId}/sync'
curl -X POST 'http://开发机地址:18081/api/v1/governance/issues/{issueId}/notifications/remind' \
  -H 'Idempotency-Key: reminder-20260805-001'
curl -X POST 'http://开发机地址:18081/api/v1/governance/sla/scan'
curl -X POST 'http://开发机地址:18081/api/v1/governance/notifications/deliver'
```

复检提交后，控制面先落库 `quality_rule_runs` 执行批次，再在事务外投递质量规则执行器。后台按轮询周期读取 `SUBMITTING/SUBMITTED/RUNNING/UNKNOWN` 批次；控制面在投递前重启时会恢复 `SUBMITTING`，执行器暂时不可用则保留中间态并按退避策略重试。状态同步会将执行状态、通过标记、执行批次号和 `sampleEvidence` 回写 PostgreSQL。`SUCCEEDED + passed=true` 自动关闭问题；失败、取消或 `passed=false` 自动退回问题并记录事件。每个状态转换使用条件更新，重复轮询不会重复生成事件。

SLA 扫描只处理 `due_at < now` 且尚未标记逾期、未关闭的问题；复检中的问题保留 `RECHECKING`，但记录 `sla_overdue_at` 和 `SLA_OVERDUE` 事件，避免打断正在执行的复检。通知通过 `WEBHOOK` 适配器投递，带幂等键、数据库租约抢占、指数退避和最大尝试次数；未配置 URL 时明确记录 `SKIPPED`，不会把“未配置”显示成“已送达”。门户的“提醒责任人”会新增提醒事件并进入同一通知队列。

生产质量执行器需要实现以下最小 HTTP 契约：

```text
POST {QUALITY_RULE_EXECUTOR_BASE_URL}/api/v1/quality/runs
GET  {QUALITY_RULE_EXECUTOR_BASE_URL}/api/v1/quality/runs/{externalId}
```

提交请求会携带 `Idempotency-Key: executionBatchId`，执行器需按该键去重；提交响应返回 `externalId`（或 `runId`/`id`）；状态响应返回 `status`、`passed`、`executionBatchId`、`message`、`sampleEvidence`、`startedAt`、`finishedAt`。时间字段支持 ISO-8601 UTC、带偏移或无偏移（无偏移按 UTC）。`DATAOS_QUALITY_EXECUTOR=DBT` 与 `HTTP` 共用该适配器，便于后续将 dbt、Great Expectations 或院内规则服务替换为同一执行契约。关闭问题不能提醒责任人，同一提醒 `Idempotency-Key` 不会重复生成事件或通知。

## 回滚

只停止新增服务即可，不会影响 data-ops：

```bash
docker compose -f docker-compose.yml --profile executor down
docker compose -f docker-compose.yml down
```

这不会删除 PostgreSQL 数据卷，也不会删除 `data_os` schema。若要回滚数据变更，需按发布记录执行对应 SQL，禁止在开发机上直接删除共享数据库。
