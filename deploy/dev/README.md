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
```

## 回滚

只停止新增服务即可，不会影响 data-ops：

```bash
docker compose -f docker-compose.yml --profile executor down
docker compose -f docker-compose.yml down
```

这不会删除 PostgreSQL 数据卷，也不会删除 `data_os` schema。若要回滚数据变更，需按发布记录执行对应 SQL，禁止在开发机上直接删除共享数据库。
