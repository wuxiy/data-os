# data-os 开发环境部署

这套覆盖只新增 data-os 控制面、桌面门户和可选的 SeaTunnel 单节点执行器；DolphinScheduler 通过独立 overlay 启用，不修改 data-ops 的 Compose 文件。开发环境仍可复用 `medical-platform-keycloak-db-1`，通过 `data_os` schema 隔离表；生产部署必须使用独立业务数据库，不能复用 Keycloak 数据库。

## 组件

| 服务 | 作用 | 暴露端口 |
| --- | --- | --- |
| `control-plane` | Java 21 / Spring Boot API，初始化 PostgreSQL schema | 仅平台网络 `8080` |
| `portal` | React/Vite 静态门户与 API 反向代理 | `18081` |
| `seatunnel-master` | SeaTunnel 单节点开发执行器，可选 profile | `18082`、`15801` |
| `dolphinscheduler-*` | DolphinScheduler 单院紧凑编排器（API/Master/Worker/Alert/JDBC Registry），可选 profile | API `18083` |

## 启动

远程目录需要有以下文件：`docker-compose.yml`、`nginx.conf`、`seatunnel/seatunnel.yaml`、`portal-dist/` 和控制面镜像。不要把真实密码提交到仓库；运行时只在开发机的 `.env` 提供：

```dotenv
DATAOS_DB_PASSWORD=复用 keycloak-db 的数据库密码
DATAOS_RUNTIME_ENV=development
DATAOS_AUTH_MODE=DISABLED
DATAOS_DEFAULT_SCOPE_ENABLED=true
DATAOS_DEFAULT_TENANT_ID=default
DATAOS_DEFAULT_INSTITUTION_ID=demo-hospital
# 开发环境显式放开本机/测试来源检查；生产必须全部关闭并配置来源白名单。
DATAOS_SOURCE_ALLOW_HTTP=true
DATAOS_SOURCE_ALLOW_PRIVATE_NETWORKS=true
DATAOS_SOURCE_ALLOW_TEST_PROTOCOLS=true
DATAOS_SOURCE_ALLOWED_HOSTS=
DATAOS_FLYWAY_BASELINE_ON_MIGRATE=true
DATAOS_SEED_DEMO=true
# 可选：控制面运行状态同步周期，单位毫秒
DATAOS_RUN_SYNC_INTERVAL_MS=30000
DATAOS_RUN_SYNC_INITIAL_DELAY_MS=10000
DATAOS_SEATUNNEL_TIME_ZONE=UTC
# 可选：启用 DolphinScheduler 后，控制面通过 token 或专用服务账号调用其内网 API。
DOLPHINSCHEDULER_BASE_URL=http://dolphinscheduler-api:12345/dolphinscheduler
# 内网明文默认 disable；托管 PostgreSQL 按院方证书策略改为 require/verify-full。
DOLPHINSCHEDULER_DB_SSLMODE=disable
DATAOS_DOLPHINSCHEDULER_TOKEN=
DATAOS_DOLPHINSCHEDULER_TOKEN_FILE=/run/secrets/dolphinscheduler-token.json
DATAOS_DOLPHINSCHEDULER_USERNAME=
DATAOS_DOLPHINSCHEDULER_PASSWORD=
DATAOS_DOLPHINSCHEDULER_TIME_ZONE=Asia/Shanghai
DATAOS_DOLPHINSCHEDULER_TENANT_CODE=dataos-dev
DATAOS_DOLPHINSCHEDULER_SERVICE_USER=dataos_scheduler
DATAOS_DOLPHINSCHEDULER_QUEUE_ID=1
# DolphinScheduler 的独立数据库口令（不要与 Keycloak/data-os 口令混用）。
DOLPHINSCHEDULER_DB_PASSWORD=仅保存在开发机 .env
# 开发调度器也使用命名租户；生产同样必须关闭 default 回退并配置院方租户。
DOLPHINSCHEDULER_DEFAULT_TENANT_ENABLED=false
# 开发环境默认也使用真实的 HTTP 质量 Runtime（OIDC 在本地接收器中关闭），
# 不再把 DEMO 结果作为质量闭环事实。质量 Runtime 会对登记规则执行 dbt test。
DATAOS_QUALITY_EXECUTOR=HTTP
DATAOS_QUALITY_EXECUTOR_BASE_URL=http://quality-runner:8080
DATAOS_QUALITY_DEMO_ENABLED=false
# Replace the bracketed value in a local, uncommitted .env file only.
QUALITY_RUNNER_DB_URL=postgresql+psycopg://keycloak:replace-with-local-password@keycloak-db:5432/keycloak
QUALITY_RUNNER_AUTH_MODE=DISABLED
DORIS_FE_HOST=172.16.66.8
DORIS_FE_PORT=9030
DORIS_DATABASE=dataos_quality_acceptance
DORIS_AUDIT_DATABASE=dataos_quality_audit
DORIS_USER=dataos_quality_ro
DORIS_PASSWORD=仅保存于开发机 .env
# dbt 只读业务库、只写审计库；不要复用 DORIS_USER。
DORIS_DBT_USER=dataos_quality_dbt
DORIS_DBT_PASSWORD=仅保存于开发机 .env
DORIS_CLEANUP_USER=dataos_quality_cleanup
DORIS_CLEANUP_PASSWORD=仅保存于开发机 .env
DATAOS_QUALITY_SUBMIT_LEASE_MS=120000
# 开发通知接收器验证 HMAC；不配置时会明确 SKIPPED，不会伪造已送达。
DATAOS_NOTIFICATION_WEBHOOK_URL=http://notification-receiver:8080/notify
DATAOS_NOTIFICATION_WEBHOOK_SECRET=dev-only-notification-secret-change-me
DATAOS_NOTIFICATION_ALLOW_HTTP=true
DATAOS_NOTIFICATION_ALLOW_PRIVATE_NETWORKS=true
DATAOS_NOTIFICATION_ALLOWED_HOSTS=notification-receiver
DATAOS_NOTIFICATION_MAX_ATTEMPTS=5
DATAOS_NOTIFICATION_LEASE_MS=120000
```

开发门户静态包若要展示受控原型页，构建时显式设置 `VITE_DATAOS_DEMO_MODE=true`；未设置时为真实模式，标准、MPI、资产、分析和问数页面不会渲染静态样例。控制面运行状态可通过以下接口检查：

```text
GET /api/v1/system/status
```

控制面默认按生产环境处理；开发 Compose 显式设置 `DATAOS_RUNTIME_ENV=development`。生产环境仍应显式设置 `DATAOS_RUNTIME_ENV=production`，且不得沿用 `DATAOS_SEED_DEMO=true` 或 `DATAOS_QUALITY_EXECUTOR=DEMO`；应切换为 `HTTP` 或 `DBT` 并配置 `DATAOS_QUALITY_EXECUTOR_BASE_URL`，`DATAOS_QUALITY_DEMO_ENABLED` 保持 `false`。控制面会在启动阶段阻断违反该约束的配置，历史 FakeSource 任务也不能在生产启动。

当前 Compose 的 `DATAOS_AUTH_MODE=DISABLED` 仅用于隔离开发门户免登录联调；生产必须改为 `ENFORCED`，并提供 OIDC issuer、audience 以及 Token 中的 `tenant_id`、`institution_id` 和角色声明。Flyway 在现有开发库上通过 `DATAOS_FLYWAY_BASELINE_ON_MIGRATE=true` 接管历史 `schema.sql` 表；生产新库保持默认 `false`，只执行版本化迁移。

先启动门户和控制面：

```bash
docker compose -f docker-compose.yml up -d control-plane quality-runner notification-receiver portal
```

质量 Runtime 首次启动会创建 `data_os.quality_rule_registry` 和
`data_os.quality_runner_runs`。确认开发机可访问复用的 Doris 后，执行一次合成验收数据初始化：

```bash
# 仅在质量验收库中执行，不触碰院内业务库
mysql -h 172.16.66.8 -P 9030 -u dataos_quality_admin -p < ../scripts/init-quality-doris.sql
mysql -h 172.16.66.8 -P 9030 -u dataos_quality_admin -p < ../scripts/seed-quality-doris.sql
curl -fsS http://127.0.0.1:18081/api/v1/system/status
```

真实质量闭环验收通过条件：提交复检后，控制面应得到 `runId`，Runtime 回写通过/失败、
执行批次和最多 20 条脱敏样本证据；通知接收器 `/receipts` 能看到带 HMAC 的责任人投递。

## 启用 DolphinScheduler 编排

Gate 1 使用“已发布工作流绑定”模式：工作流定义、任务节点和版本在 DolphinScheduler 内维护；data-os 只负责提交一次工作流、保存本地运行记录并轮询实例状态。这样不会在每次业务运行时重复创建 DAG，也不会把 DolphinScheduler 原生 UI 暴露给甲方日常门户。

DolphinScheduler 使用独立 PostgreSQL 数据卷和 JDBC Registry，单院节点不启用 ZooKeeper。注册表迁移脚本是幂等的，不会在容器重启时删除工作流元数据。当前 overlay 不安装或挂载历史 Shell 任务插件；临床采集由控制面通过 SeaTunnel 真实连接器执行，调度器只承接已审核的编排绑定。首次启动前，在本目录 `.env` 设置 `DOLPHINSCHEDULER_DB_PASSWORD`，并先创建 `DATAOS_DOLPHINSCHEDULER_TENANT_CODE` 对应的命名租户和 `dataos_scheduler` 服务账号，然后执行：

```bash
docker compose \
  -f docker-compose.yml \
  -f dolphinscheduler/docker-compose.yml \
  --profile scheduler up -d
```

调度器 schema 完成后，用仓库内幂等脚本绑定服务账号、确保队列存在，并归档本仓库历史 Gate 1 Shell 工作流及 data-os 中对应的旧调度任务（不会删除定义）：

```bash
DATAOS_DOLPHINSCHEDULER_TENANT_CODE=dataos-dev \
  ./dolphinscheduler/provision-named-tenant.sh
```

健康检查与 API 地址：

```bash
curl -fsS http://127.0.0.1:18083/dolphinscheduler/actuator/health
# API 仅供内网控制面调用；18083 是开发机诊断端口，生产不要映射公网。
```

若只更新了调度器服务，先确认 schema initializer 成功，再重建 API、Master、Worker。开发 Compose 允许控制面 `DATAOS_DEFAULT_SCOPE_ENABLED=true` 作为免登录联调回退，但 DolphinScheduler Worker 的 `WORKER_TENANT_CONFIG_DEFAULT_TENANT_ENABLED` 默认关闭；生产同时关闭控制面 default scope 和 Worker default tenant，所有绑定必须使用已创建的命名租户。

建议在 DolphinScheduler 中创建专用服务账号并生成 bootstrap token，写入命名卷
`data-os-dev-scheduler-token-secrets` 的 `/run/secrets/dolphinscheduler-token.json`，再
启用 `scheduler-token-rotator` profile。轮换器每 24 小时生成新 token，控制面在 30 分钟
重叠窗口内热读 current/previous；不再支持用户名/密码登录回退，也不要把 token 写入任务
配置、日志或 Git。

采集任务的 `executor` 设为 `DOLPHINSCHEDULER`，保存一个已发布工作流绑定。配置边界如下（`workflowDefinitionVersion` 仅作为审计元数据，启动接口使用已发布版本）：

```json
{
  "dolphinscheduler": {
    "projectCode": 10001,
    "workflowDefinitionCode": 10002,
    "workflowDefinitionVersion": 1,
    "workerGroup": "default",
    "tenantCode": "dataos-dev",
    "startParams": {
      "source_id": "lis-readonly",
      "data_domain": "检验"
    }
  }
}
```

控制面提交后会把持久化运行编号追加为 `dataos_run_id`，外部编号以 `ds|项目编号|工作流编号|实例编号` 形式保存；DolphinScheduler 的 `SUCCESS/FAILURE/STOP` 等状态会归一为 data-os 的 `SUCCEEDED/FAILED/CANCELED`。当前阶段不动态发布工作流定义，也不依赖 DolphinScheduler 内置 SeaTunnel 节点去调用现有 SeaTunnel REST；临床 LIS/EMR/手术系统任务使用控制面目录中的 SeaTunnel 真实连接器模板，DolphinScheduler 只承接经过审核的计划/补数编排绑定。

提交请求和控制面运行记录都带有 `dataos_run_id`，但 DolphinScheduler 3.4.x 的公开工作流实例查询接口不能按该启动参数做可靠的服务端唯一查询。因此，控制面不会在提交响应超时后自动重试，避免将“已提交但响应丢失”误判为失败而重复执行；此类运行保持 `BLOCKED_DEPENDENCY`，需先在 DolphinScheduler 侧核对实例，再人工处理。下一阶段再通过对账表/适配器扩展补齐跨系统幂等，不把当前能力宣称为 exactly-once。

SeaTunnel 使用仓库根目录 `deploy/seatunnel/` 的固定制品清单构建本地开发镜像。
镜像只包含 JDBC 和 Doris 连接器，不安装 Shell 插件。受控构建机可在线按清单
下载，院方/隔离环境则把官方 tar、连接器 JAR 和驱动放入缓存后设置
`SEATUNNEL_OFFLINE_BUILD=true`，构建阶段不会下载 SeaTunnel/连接器；基础镜像和
系统包仍需预先导入受控构建机或由其内部镜像提供：

```bash
export SEATUNNEL_DRIVER_PROFILE=postgresql
export SEATUNNEL_DRIVER_DIR=/path/to/controlled-jars
export SEATUNNEL_CONNECTOR_DIR=/path/to/connector-cache
export SEATUNNEL_IMAGE_TAG=medical-platform/data-os-seatunnel:2.3.13-dataos.2
deploy/seatunnel/scripts/build-image.sh
```

运行时镜像默认是 `medical-platform/data-os-seatunnel:2.3.13-dataos.2`；若已有合规
镜像，可通过 `SEATUNNEL_IMAGE` 覆盖。使用已构建镜像时不需要 `--build`：

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

凭据引用只保存 AES-GCM 加密密文，API 响应不回显 secret。创建凭据后在采集配置中使用 `credentialRef`，不要在任务 JSON 或来源检查请求中提交 password、secret、token 等明文键：

```bash
curl -fsS -X POST http://开发机地址:18081/api/v1/credentials \
  -H 'Content-Type: application/json' \
  -d '{"name":"lis-readonly","provider":"JDBC","secret":{"username":"readonly","password":"<provided-at-runtime>"},"metadata":{"owner":"信息中心"}}'
curl -fsS http://开发机地址:18081/api/v1/credentials
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
curl -fsS http://127.0.0.1:18083/dolphinscheduler/actuator/health
# 查询某条运行记录（需先从 POST /api/v1/jobs/{jobId}/runs 获取 runId）
curl -fsS -X POST http://127.0.0.1:18081/api/v1/jobs/{jobId}/runs/{runId}/sync
# 用已保存任务配置启动，并用同一 key 重试验证幂等
curl -fsS -X POST http://127.0.0.1:18081/api/v1/jobs/{jobId}/runs \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: acceptance-run-1' -d '{}'
```

浏览器访问 `http://开发机地址:18081/`。治理驾驶舱顶部显示“控制面已连接”时，指标与问题来自复用 PostgreSQL 的 `data_os` schema；数据质量闭环页同样从 `governance_issues` 与 `governance_issue_events` 读取真实队列和处理记录。控制面不可用时，治理驾驶舱、数据接入和质量闭环均不会展示演示业务数据，而是显示不可用空态。门户顶部的运行状态条会显示真实/演示模式、质量执行器配置和未配置告警。

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
docker compose -f docker-compose.yml --profile executor stop seatunnel-master
docker compose -f docker-compose.yml -f dolphinscheduler/docker-compose.yml --profile scheduler stop \
  dolphinscheduler-api dolphinscheduler-alert dolphinscheduler-master dolphinscheduler-worker \
  dolphinscheduler-schema-initializer dolphinscheduler-registry-schema dolphinscheduler-postgresql
```

如需连同 data-os 门户/控制面一起停机，再单独执行 `docker compose -f docker-compose.yml down`；这不是回滚调度器的必需步骤。

这不会删除 PostgreSQL 数据卷，也不会删除 `data_os` schema。若要回滚数据变更，需按发布记录执行对应 SQL，禁止在开发机上直接删除共享数据库。
