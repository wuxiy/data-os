# data-os 生产部署（Compose 基线）

这套 Compose 是 Gate 0 的单机生产基线：控制面使用 OIDC/JWT，数据库由 Flyway 自动迁移，门户只暴露业务 API，Prometheus 从控制面 Actuator 拉取基础指标。它适合单院或区域平台的第一台生产节点；高可用、外置数据库、TLS 终止和密钥托管应由甲方现有平台或后续 Kubernetes/Helm 部署承接。

## 运行前提

- Docker Engine 24+、Docker Compose v2.20+。
- 一个可访问的 PostgreSQL 16（可使用本目录的容器，也可以把控制面切到院内托管库）。
- 一个 OIDC issuer（Keycloak/其他兼容 IdP），并在 token 中提供 `tenant_id`、`institution_id` 和角色 claim；角色由 API 的 `ROLE_` 映射规则校验。
- 一个公开 OIDC 客户端（推荐 Authorization Code + PKCE），允许门户域名作为 redirect URI，并将 `data-os` 配置为 token audience。门户会在浏览器中完成登录并为同源 API 注入 Bearer token，不依赖匿名反向代理会话。
- 已构建并推送的控制面镜像，以及和该版本匹配的门户静态包。
- 一个由 `openssl rand -base64 32` 生成的凭据加密密钥。密钥属于部署机秘密，不能提交 Git，也不能在日志中打印。

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

## 首次部署

```bash
cd deploy/production
cp .env.example .env
# 编辑 .env：数据库口令、OIDC issuer/audience、加密密钥、质量执行器和来源白名单。
chmod 600 .env

docker compose --env-file .env config --quiet
docker compose --env-file .env up -d postgres
docker compose --env-file .env up -d control-plane portal prometheus
docker compose --env-file .env ps
```

`control-plane` 健康检查通过后，Flyway 会在 `data_os` schema 上执行版本化迁移；应用不会再执行旧的 `schema.sql` 初始化。若使用外部 PostgreSQL，请把 `.env` 中的 `DATAOS_DB_URL` 改成外部地址，并删除/停用 `postgres` 服务，避免误用本地卷。

浏览器入口默认为 `http://<host>:8080/`（容器内 nginx 非 root 监听 `8080`），健康检查为 `GET /healthz`。PostgreSQL 不映射宿主机端口；需要临时管理时使用经过审批的 Compose override 或容器内 `psql`。Prometheus 仅绑定到宿主机回环地址 `127.0.0.1:19090`，通过 SSH 隧道或甲方监控网络访问；不要把它直接暴露到公网。

首次打开门户时会跳转到 OIDC 登录页；IdP 必须允许门户的完整 HTTPS redirect URI，且客户端启用 PKCE 公共客户端模式。门户只把 access token 放在当前浏览器 session storage，退出登录或关闭浏览器后清理；API 仍会在控制面校验 issuer、audience、过期时间和租户声明。若甲方统一入口已提供 SSO 反向代理，仍需让代理透传 `Authorization`，不能将匿名请求直接转发到控制面。

## 必须检查的生产配置

- `DATAOS_RUNTIME_ENV=production`、`DATAOS_SEED_DEMO=false`。
- `DATAOS_AUTH_MODE=ENFORCED`，OIDC issuer 必须是可信 HTTPS 地址；生产不启用本地匿名模式。
- `DATAOS_CREDENTIAL_ENCRYPTION_KEY` 必须是 32 字节 Base64 密钥，并由独立的秘密管理流程分发。
- `DATAOS_SOURCE_ALLOW_HTTP=false`、`DATAOS_SOURCE_ALLOW_PRIVATE_NETWORKS=false`、`DATAOS_SOURCE_ALLOW_TEST_PROTOCOLS=false`；仅在完成网络评审后增加 `DATAOS_SOURCE_ALLOWED_HOSTS`。
- `DATAOS_QUALITY_EXECUTOR` 使用 `HTTP`/`DBT`，`DATAOS_QUALITY_DEMO_ENABLED=false`，并配置真实执行器地址。
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
