# data-os 生产部署（Compose 基线）

这套 Compose 是 Gate 0 的单机生产基线：控制面使用 OIDC/JWT，数据库由 Flyway 自动迁移，门户只暴露业务 API，Prometheus 从控制面 Actuator 拉取基础指标。它适合单院或区域平台的第一台生产节点；高可用、外置数据库、TLS 终止和密钥托管应由甲方现有平台或后续 Kubernetes/Helm 部署承接。

## 运行前提

- Docker Engine 24+、Docker Compose v2.20+。
- 一个可访问的 PostgreSQL 16（可使用本目录的容器，也可以把控制面切到院内托管库）。
- 一个 OIDC issuer（Keycloak/其他兼容 IdP），并在 token 中提供 `tenant_id`、`institution_id` 和角色 claim；角色由 API 的 `ROLE_` 映射规则校验。
- 一个公开 OIDC 客户端（推荐 Authorization Code + PKCE），允许门户域名作为 redirect URI，并将 `data-os` 配置为 token audience。门户会在浏览器中完成登录并为同源 API 注入 Bearer token，不依赖匿名反向代理会话。
- 已构建并推送的控制面镜像，以及和该版本匹配的门户静态包。
- 已构建并导入院内镜像仓库的 `data-os-quality-runner` 与 Token 轮换器镜像；质量运行时只接受登记规则，禁止任意 Shell/SQL。
- 可访问复用的 Doris FE（默认 `172.16.66.8:9030`）和院方 RustFS/S3 端点；Doris 使用只读质量账号，RustFS 只保存脱敏汇总证据。
- 质量 Runtime 的 Doris 账号分为三类：`DORIS_USER` 只读业务质量库，`DORIS_DBT_USER` 只读业务库并仅写入 `DORIS_AUDIT_DATABASE`，`DORIS_CLEANUP_USER` 只负责删除已登记的 dbt 失败表；三者不能共用。
- 一个由 `openssl rand -base64 32` 生成的凭据加密密钥。密钥属于部署机秘密，不能提交 Git，也不能在日志中打印。
- 一个权限为 `0600` 的责任人通知签名文件（例如 `/etc/data-os/notification-webhook.json`），内容为 `{"current":"<rotatable-secret>"}`；Compose 以只读方式挂载，生产不应把签名密钥写入 Git 或普通 `.env`。
- SeaTunnel 执行器离线包（正式环境必须包含 `SHA256SUMS.sig`），或甲方已经验收的院内 SeaTunnel 集群地址。

## 构建制品

在仓库根目录执行：

```bash
mvn -B -f services/control-plane/pom.xml clean package
docker build -t medical-platform/data-os-control-plane:0.1.0 \
  services/control-plane

cp prototype/.env.production.example prototype/.env.production
# 编辑 prototype/.env.production：OIDC issuer、公开 client id、准确 redirect URI。
npm ci --prefix prototype
npm run build --prefix prototype
mkdir -p deploy/production/portal-dist
cp -a prototype/dist/. deploy/production/portal-dist/
```

生产构建不设置 `VITE_DATAOS_DEMO_MODE=true`。未接入的页面必须呈现真实空态或不可用状态，不能把 demo 数据当作业务事实。

## 导入 SeaTunnel 离线执行器

院方环境默认按无互联网交付设计。SeaTunnel 连接器和数据库驱动在受控发布机
构建进镜像，生产部署期间不执行插件安装脚本、不从 Maven 或其他公网下载，也
不恢复历史 DolphinScheduler Shell 插件。离线包格式、驱动许可证边界和单节点
恢复语义见 [`docs/seatunnel-offline-release.md`](../../docs/seatunnel-offline-release.md)。

把正式包和受控公钥拷贝到部署机后，先验签和导入：

```bash
bundle=/opt/release/data-os-seatunnel-2.3.13-linux-amd64
deploy/seatunnel/scripts/verify-offline-bundle.sh \
  --bundle "$bundle" --public-key /etc/data-os/release.pub
deploy/seatunnel/scripts/load-offline-bundle.sh \
  --bundle "$bundle" --public-key /etc/data-os/release.pub
```

验证和导入阶段不会启动或重启生产服务。需要院内 OCI 仓库时，可把已验签包中的
镜像归档导入仓库并使用返回的不可变 digest；不要在仓库中重新构建或在线补装
连接器。开发合成验证才允许 `--allow-unsigned`，不能把未签名包带入生产。
若激活脚本使用院内仓库的 digest 引用，需同时设置
`DATAOS_ACTIVATION_IMAGE=<院内仓库>/<项目>/data-os-seatunnel@sha256:<digest>`；脚本会
把该引用写入 `.env`，并校验其镜像 ID 与离线包清单一致。

## 选择 SeaTunnel 运行模式

### 本地单院 executor

单院没有可复用的 SeaTunnel 集群时，复制包中的 overlay 和配置到本目录，设置
`.env` 中的 `SEATUNNEL_IMAGE`（推荐使用院内仓库 digest）以及
`SEATUNNEL_BASE_URL=http://seatunnel-master:8080`，在变更窗口显式激活：

```bash
DATAOS_ACTIVATE_CONFIRM=YES \
  deploy/seatunnel/scripts/activate.sh \
  --bundle "$bundle" \
  --compose-root "$PWD" \
  --env-file "$PWD/.env"
```

overlay 会把执行器接入 `platform-net`，持久化日志、checkpoint 和 work 目录，
并以非 root、只读根文件系统运行。它是批处理单节点基线；目标表可用 UNIQUE KEY
和批次策略实现幂等，但控制面当前尚未持久化或注入水位，也不提供自动故障转移、
CDC 或区域高可用。

激活脚本默认要求正式包签名。`DATAOS_ALLOW_UNSIGNED=true` 只允许在环境文件明确
设置 `DATAOS_RUNTIME_ENV=development` 的隔离开发环境使用，生产环境会直接拒绝。

### 使用院内既有 SeaTunnel 集群

不启动本地 executor，只在 `.env` 设置院内 API 地址，然后校验外部 overlay：

```bash
SEATUNNEL_BASE_URL=http://seatunnel-api.example.invalid:8080
docker compose --env-file .env \
  -f docker-compose.yml -f seatunnel-external-compose.yml config --quiet
docker compose --env-file .env \
  -f docker-compose.yml -f seatunnel-external-compose.yml up -d control-plane
```

外部集群的连接器、驱动、租户和网络策略由院方 SeaTunnel 运维团队负责；data-os
只保存经过凭据服务解析的连接引用，不在任务 JSON 中写入数据库密码。

## 首次部署

```bash
cd deploy/production
cp .env.example .env
# 编辑 .env：数据库口令、OIDC issuer/audience、加密密钥、质量执行器和来源白名单。
chmod 600 .env
# 先准备通知签名文件，并让 DATAOS_NOTIFICATION_WEBHOOK_SECRET_HOST_FILE 指向它。
install -d -m 700 /etc/data-os
install -m 600 /path/from/secret-manager/notification-webhook.json /etc/data-os/notification-webhook.json

docker compose --env-file .env config --quiet
docker compose --env-file .env up -d postgres
docker compose --env-file .env up -d control-plane portal prometheus
docker compose --env-file .env ps
```

`control-plane` 健康检查通过后，Flyway 会在 `data_os` schema 上执行版本化迁移；应用不会再执行旧的 `schema.sql` 初始化。若使用外部 PostgreSQL，请把 `.env` 中的 `DATAOS_DB_URL` 改成外部地址，并删除/停用 `postgres` 服务，避免误用本地卷。

浏览器入口默认为 `http://<host>:8080/`（容器内 nginx 非 root 监听 `8080`），健康检查为 `GET /healthz`。PostgreSQL 不映射宿主机端口；需要临时管理时使用经过审批的 Compose override 或容器内 `psql`。Prometheus 仅绑定到宿主机回环地址 `127.0.0.1:19090`，通过 SSH 隧道或甲方监控网络访问；不要把它直接暴露到公网。

首次打开门户时会跳转到 OIDC 登录页；IdP 必须允许门户的完整 HTTPS redirect URI，且客户端启用 PKCE 公共客户端模式。门户只把 access token 放在当前浏览器 session storage，退出登录或关闭浏览器后清理；API 仍会在控制面校验 issuer、audience、过期时间和租户声明。若甲方统一入口已提供 SSO 反向代理，仍需让代理透传 `Authorization`，不能将匿名请求直接转发到控制面。

## 启用 DolphinScheduler 编排器（Gate 1）

生产调度器是独立的 Compose overlay，不与 data-os/Keycloak 共用数据库账号。甲方平台需要先 provision 一个专用 PostgreSQL 数据库（建议数据库名 `dolphinscheduler`）和最小权限账号；overlay 会先执行 DolphinScheduler 主 schema 与幂等 JDBC Registry 表迁移，再启动 API、Master、Worker、Alert。单院节点默认不启用 ZooKeeper；区域高可用应改用独立调度集群和外部注册中心方案评审。

在 `.env` 中增加以下仅部署机可读的变量：

```dotenv
DOLPHINSCHEDULER_TAG=3.4.1
DOLPHINSCHEDULER_DB_HOST=院内 PostgreSQL 主机
DOLPHINSCHEDULER_DB_PORT=5432
DOLPHINSCHEDULER_DB_NAME=dolphinscheduler
DOLPHINSCHEDULER_DB_USERNAME=dolphinscheduler_runtime
DOLPHINSCHEDULER_DB_PASSWORD=仅保存在部署机秘密文件
DOLPHINSCHEDULER_DB_SSLMODE=disable  # 托管库按证书策略改为 require/verify-full
DOLPHINSCHEDULER_API_PORT=19083
DOLPHINSCHEDULER_TZ=Asia/Shanghai
DOLPHINSCHEDULER_BASE_URL=http://dolphinscheduler-api:12345/dolphinscheduler
DATAOS_DOLPHINSCHEDULER_TOKEN_FILE=/run/secrets/dolphinscheduler-token.json
DATAOS_DOLPHINSCHEDULER_TENANT_CODE=院方创建的命名调度租户编码
DATAOS_DOLPHINSCHEDULER_SERVICE_USER=dataos_scheduler
DATAOS_DOLPHINSCHEDULER_QUEUE_ID=1
DATAOS_DOLPHINSCHEDULER_USERNAME=
DATAOS_DOLPHINSCHEDULER_PASSWORD=
DOLPHINSCHEDULER_TOKEN_USER_ID=调度服务账号的数值 user id
DOLPHINSCHEDULER_TOKEN_TTL_DAYS=7
DOLPHINSCHEDULER_TOKEN_ROTATE_HOURS=24
DOLPHINSCHEDULER_TOKEN_OVERLAP_MINUTES=30
```

`DATAOS_DEFAULT_SCOPE_ENABLED=false`、`DATAOS_DEFAULT_TENANT_ID`、
`DATAOS_DEFAULT_INSTITUTION_ID` 和 `DATAOS_DOLPHINSCHEDULER_TENANT_CODE` 在生产是
fail-closed 配置。DolphinScheduler 中必须先创建同名租户，并把 data-os 服务账号绑定到该租户；
生产 overlay 将 Worker 的 `WORKER_TENANT_CONFIG_DEFAULT_TENANT_ENABLED` 硬编码为 `false`；
default 租户只允许在隔离开发环境中作为历史数据迁移对象，不能作为 Worker 或 API 的隐式回退。

先校验并启动 data-os，再按 overlay 启动调度器。overlay 会先执行数据库迁移，成功后才启动 API、Master、Worker、Alert；overlay 不安装历史 Shell 任务插件，临床连接器工作流由 SeaTunnel 执行器承接：

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env -f docker-compose.yml -f dolphinscheduler-compose.yml up -d
docker compose --env-file .env -f docker-compose.yml -f dolphinscheduler-compose.yml ps
curl -fsS http://127.0.0.1:19083/dolphinscheduler/actuator/health
```

调度器首次启用前，将一次性 bootstrap token 写入命名卷
`data-os-production-scheduler-token-secrets` 的
`/run/secrets/dolphinscheduler-token.json`（权限 `0600`），再启动 `scheduler-token-rotator`：

```bash
docker compose --env-file .env -f docker-compose.yml --profile scheduler up -d scheduler-token-rotator
```

轮换器每 24 小时生成 7 天 Token，并保留前一个 Token 30 分钟；控制面每次请求热读
`current/previous`，401 时只在重叠窗口重试 previous。生产不再支持用户名/密码登录回退，
也不把 Token 写入任务配置、日志或 Git。

调度器 schema 初始化完成、服务账号已创建后，在仓库根目录执行一次幂等租户迁移。脚本会校验命名租户和队列、把服务账号绑定到该租户，并将本仓库历史 `dataos_gate1_shell_*` 定义及 data-os 对应旧调度任务置为归档状态；不会删除调度器定义或其他业务工作流：

```bash
chmod +x deploy/production/provision-named-tenant.sh
./deploy/production/provision-named-tenant.sh
```

脚本读取 `deploy/production/.env` 中的 DolphinScheduler 和 data-os PostgreSQL 连接信息，不输出密码或 token；因此需要同时设置 `DOLPHINSCHEDULER_DB_*` 与 `DATAOS_DB_HOST/PORT/NAME/USERNAME/PASSWORD`。若生产机器没有 `psql` 客户端，应使用同版本 PostgreSQL 客户端容器分别执行 `deploy/dolphinscheduler/clinical-tenant-migration.sql` 和 `deploy/data-os/clinical-workflow-migration.sql`，并在执行前确认两个数据库的备份与变更审批均已完成。

API 诊断端口只绑定 `127.0.0.1`，不通过门户或公网暴露。首次部署仍需由调度管理员在内网完成一次性服务账号、项目和已发布工作流绑定；data-os 任务配置只保存 `projectCode`、`workflowDefinitionCode`、版本审计信息和非敏感启动参数，调度器密码/token 不进入任务 JSON。

控制面把 data-os 运行编号写入 `startParams.dataos_run_id`，但当前 DolphinScheduler 公开 API 无法按该启动参数可靠对账。因而提交响应超时会进入 `BLOCKED_DEPENDENCY`，不会自动重试；运维人员需先在调度器中核对实例，再人工处理，避免重复采集。跨系统幂等对账列为下一阶段 Gate 1 P1，不把当前方案宣称为 exactly-once。

## 必须检查的生产配置

- `DATAOS_RUNTIME_ENV=production`、`DATAOS_SEED_DEMO=false`。
- `DATAOS_AUTH_MODE=ENFORCED`，OIDC issuer 必须是可信 HTTPS 地址；生产不启用本地匿名模式。
- `DATAOS_CREDENTIAL_ENCRYPTION_KEY` 必须是 32 字节 Base64 密钥，并由独立的秘密管理流程分发。
- `DATAOS_SOURCE_ALLOW_HTTP=false`、`DATAOS_SOURCE_ALLOW_PRIVATE_NETWORKS=false`、`DATAOS_SOURCE_ALLOW_TEST_PROTOCOLS=false`；仅在完成网络评审后增加 `DATAOS_SOURCE_ALLOWED_HOSTS`。
- `DATAOS_QUALITY_EXECUTOR=HTTP`、`DATAOS_QUALITY_DEMO_ENABLED=false`，并将
  `DATAOS_QUALITY_EXECUTOR_BASE_URL` 指向本 Compose 的 `http://quality-runner:8080`；
  质量运行时使用独立容器执行登记的 dbt test，结果、执行批次和最多 20 条脱敏证据回写
  `data_os.quality_runner_runs`，汇总 JSON 写入 RustFS/S3。质量查询账号仅授予验收库
  `SELECT`，清理账号仅授予同库失败表的受控 `DROP`；控制面通过 OIDC client
  credentials 获取 5 分钟短 token，仅授予 `quality:submit/read`。
- 控制面的 `DATAOS_QUALITY_OIDC_TOKEN_URI/CLIENT_ID/CLIENT_SECRET` 必须指向院方 IdP
  为 `dataos-quality-runner` 签发的 client-credentials 客户端；三项缺失时生产 Compose
  不允许启动，client secret 不得写入门户或任务 JSON。
- 首次验收前，在 Doris 8030/9030 执行 [`init-quality-doris.sql`](../scripts/init-quality-doris.sql)
  和 [`seed-quality-doris.sql`](../scripts/seed-quality-doris.sql)，再从门户发起复检；
  null、重复主键和非法状态样本应分别得到失败、证据与执行批次。
- 责任人通知必须配置 `DATAOS_NOTIFICATION_WEBHOOK_URL`、签名密钥（推荐
  `DATAOS_NOTIFICATION_WEBHOOK_SECRET_FILE`）和 `DATAOS_NOTIFICATION_ALLOWED_HOSTS`；
  通道以 `timestamp.nonce.payload` 的 HMAC-SHA256 签名发送，生产缺任一项会阻止启动。
- 容器网络不直接公开 PostgreSQL；生产反向代理或负载均衡器负责 TLS、证书轮换和访问控制。
- 发布前编辑 `deploy/production/nginx.conf` 中 CSP 的 `https://id.example.invalid`，替换成实际 OIDC issuer host；该配置故意不允许门户向任意跨域地址发起 discovery/token 请求。

Compose 文件使用 `read_only` 根文件系统、非 root 控制面用户、`no-new-privileges` 和丢弃 Linux capabilities。若甲方镜像仓库启用签名或漏洞门禁，应在推送前对控制面和 nginx/Postgres/Prometheus 镜像执行同等检查。

## 迁移、备份与升级

升级前先备份数据库并记录镜像、迁移版本和配置摘要（不要记录任何密码/Token）：

```bash
docker compose --env-file .env exec -T postgres \
  pg_dump -U "$DATAOS_DB_USERNAME" -d "$DATAOS_DB_NAME" --format=custom \
  > "backup-$(date +%Y%m%d-%H%M%S).dump"

docker compose --env-file .env pull control-plane portal prometheus
docker compose --env-file .env up -d control-plane portal prometheus
docker compose --env-file .env ps
curl -fsS http://127.0.0.1:8080/healthz
```

Flyway 只允许向前迁移，禁止在共享生产库执行 `clean` 或手工删除迁移历史。回滚应用时使用上一份不可变镜像；若迁移不可逆，按发布记录执行对应的补偿迁移并从备份恢复，不要用 `docker compose down -v`。

### 既有开发库的一次性基线

如果目标 `data_os` 已由旧版 `schema.sql` 创建、但不存在 `flyway_schema_history`，不得直接把 `DATAOS_FLYWAY_BASELINE_ON_MIGRATE` 永久打开。完成备份和变更审批后，先在 `.env` 中临时设置：

```dotenv
DATAOS_FLYWAY_BASELINE_ON_MIGRATE=true
DATAOS_FLYWAY_BASELINE_VERSION=0
```

启动一次控制面，确认日志显示 baseline 和 `V1__baseline` 均成功，再检查 `data_os.flyway_schema_history`，确认版本为 `1`：

```bash
docker compose --env-file .env exec -T postgres \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "select version, description, success from data_os.flyway_schema_history order by installed_rank;"'
```

随后将这两个变量恢复为 `false`/`0` 并重新启动控制面；后续发布只允许由新的 Flyway 迁移向前变更。若旧库结构不是本仓库基线，先在副本库演练并人工核对列、索引和外键，禁止用 baseline 掩盖结构差异。

## 监控与故障处理

- `GET /healthz`：由门户反向代理到 readiness，供负载均衡器使用。
- `GET /actuator/health/liveness`、`GET /actuator/health/readiness`：仅在平台网络内使用。
- `GET /actuator/prometheus`：Prometheus 抓取入口，不经公共门户转发。
- Prometheus 配置见 [`prometheus.yml`](./prometheus.yml)，默认保留 15 天；长期指标应接入甲方现有监控存储。

控制面不可用时先查看 `docker compose logs --tail=200 control-plane`，再核对 OIDC issuer、数据库连接、迁移版本和来源白名单。日志中不得粘贴 `Authorization`、数据库口令或凭据明文。数据卷删除是破坏性操作，任何 `down -v` 或 `rm` 前必须完成离线备份并取得变更批准。

## 停止与回滚

```bash
docker compose --env-file .env stop portal control-plane prometheus
# 回滚到上一镜像后：
docker compose --env-file .env up -d control-plane portal prometheus
```

只停止新增服务不会影响外部 SeaTunnel、Keycloak 或共享 PostgreSQL。不要删除 `data-os-production-postgres` 卷；需要清理时应走正式数据保留和恢复流程。
