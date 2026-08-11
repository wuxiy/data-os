# 开发环境信息与组件访问查询卡

> 本文档用于开发演示环境的日常查询，最后核验时间：2026-08-11。
> 文档可以提交到 Git；真实密码、Secret、Token 和数据库连接串不写入仓库，统一从开发机受保护的 `.env` 或 Secret 卷读取。

## 1. 环境概览

| 项目 | 当前值 |
| --- | --- |
| 开发服务器 | `172.16.65.59` |
| SSH 账号 | `root` |
| SSH 认证 | 公钥认证（当前不使用密码登录） |
| 远程部署目录 | `/root/data-os-dev-20260803` |
| 远程运行配置 | `/root/data-os-dev-20260803/.env`，权限应保持 `0600` |
| 备份/回滚目录 | 以部署记录中的 `rollback-*` 或 `data-os-dev-*-pre` 目录为准 |
| Docker 网络 | `platform-net`（复用 data-ops） |
| 复用 PostgreSQL | `keycloak-db:5432/keycloak`，data-os 使用 `data_os` schema |
| 复用 Doris | `172.16.66.8:9030`，仅使用质量验收库和审计库 |

生产环境不要直接复用以上地址、账号、Secret 或端口；生产配置以
[`deploy/production/README.md`](../deploy/production/README.md) 和院方 Secret 管理规范为准。

## 2. 浏览器访问入口

以下地址从能访问开发服务器的内网浏览器打开：

| 用途 | 访问地址 | 使用人 | 说明 |
| --- | --- | --- | --- |
| 统一门户 | [http://172.16.65.59:18081/](http://172.16.65.59:18081/) | 业务与技术人员 | 甲方日常只使用此入口 |
| 平台运维舱 | [http://172.16.65.59:18081/operations](http://172.16.65.59:18081/operations) | 技术人员 | 门户内聚合组件状态和受控外链 |
| 门户健康检查 | [http://172.16.65.59:18081/healthz](http://172.16.65.59:18081/healthz) | 运维人员 | Nginx/静态站点健康检查 |
| 控制面就绪检查 | `http://172.16.65.59:18081/api/v1/system/status` | 运维人员 | 通过门户反向代理访问，不暴露内部地址 |
| SeaTunnel 运行态 | [http://172.16.65.59:18082/overview](http://172.16.65.59:18082/overview) | 技术人员 | SeaTunnel 2.3.13；当前为运行态 API 页面 |
| DolphinScheduler UI | [http://172.16.65.59:18083/dolphinscheduler/ui/](http://172.16.65.59:18083/dolphinscheduler/ui/) | 技术人员 | 原生 UI，不作为甲方日常入口 |
| DolphinScheduler 健康检查 | `http://172.16.65.59:18083/dolphinscheduler/actuator/health` | 运维人员 | API 端口根路径 `/` 返回 404 是预期行为 |
| RustFS S3 API | `http://172.16.65.59:19000` | 技术人员/服务 | S3 兼容 API；质量运行器使用容器内地址 |
| RustFS Console | [http://172.16.65.59:19001/rustfs/console/](http://172.16.65.59:19001/rustfs/console/) | 技术人员 | 对象存储管理，不展示给甲方 |
| Doris FE | `172.16.66.8:8030`（HTTP） / `172.16.66.8:9030`（MySQL） | 技术人员 | 复用开发环境；生产必须更换为院方地址 |

SeaTunnel、RustFS 和 DolphinScheduler 的原生入口只给技术人员。门户“平台运维”菜单在生产由
OIDC 技术角色控制（`data-engineer`、`platform-operator`、`platform-admin`），隐藏菜单不能替代后端授权。

## 3. 组件账号、密码和 Token 查询位置

下表记录账号和凭据的**来源**，不记录秘密值本身。密码值只允许在开发机受保护文件或 Secret 卷中查询。

| 组件 | 账号/角色 | 密码或 Token 查询位置 | 用途与边界 |
| --- | --- | --- | --- |
| data-os 控制面 / PostgreSQL | `keycloak`（开发复用库） | `/root/data-os-dev-20260803/.env` 的 `DATAOS_DB_PASSWORD` | 控制面访问 `keycloak-db:5432/keycloak` 的 `data_os` schema |
| DolphinScheduler API | `dataos_scheduler` 服务账号；租户 `dataos-dev`；队列 ID `1` | 短周期 Token 在 Docker volume `data-os-dev-scheduler-token-secrets` 的 `current/previous` 文件；轮换参数见 `.env` | 控制面提交已发布工作流；不使用用户名/密码回退 |
| DolphinScheduler 元数据库 | `dolphinscheduler` | `.env` 的 `DOLPHINSCHEDULER_DB_PASSWORD` | 仅供 DS 容器访问 `dolphinscheduler` 数据库，不能与 data-os 数据库口令混用 |
| RustFS | Access Key 由 `DATAOS_RUSTFS_ACCESS_KEY` 提供 | `.env` 的 `DATAOS_RUSTFS_ACCESS_KEY` / `DATAOS_RUSTFS_SECRET_KEY` | S3 桶 `dataos-quality-artifacts`；SSE-S3 主密钥为 `DATAOS_RUSTFS_SSE_S3_MASTER_KEY` |
| 质量运行器 / Doris 只读 | `dataos_quality_ro` | `.env` 的 `DORIS_PASSWORD` | 只读 `dataos_quality_acceptance` 业务验收库 |
| 质量运行器 / dbt | `dataos_quality_dbt` | `.env` 的 `DORIS_DBT_PASSWORD` | 读取验收库并在 `dataos_quality_audit` 写失败表 |
| 质量运行器 / 清理 | `dataos_quality_cleanup` | `.env` 的 `DORIS_CLEANUP_PASSWORD` | 仅清理已登记的质量失败表 |
| 质量运行器 / PostgreSQL | `keycloak`（开发复用） | `.env` 的 `QUALITY_RUNNER_DB_URL`，不要复制到工单或日志 | 保存质量运行、租约和幂等记录；生产改为独立 data-os 数据库 |
| 通知接收器（开发） | 无登录账号 | `.env` 的 `DATAOS_NOTIFICATION_WEBHOOK_SECRET` | 仅用于开发 HMAC 回执；生产替换为院方消息网关，不部署该接收器 |
| SeaTunnel | 无业务账号 | 无；控制面通过容器内 `http://seatunnel-master:8080` 调用 | 运行时不向门户返回连接串或凭据 |
| 门户 / OIDC | 开发：`DATAOS_AUTH_MODE=DISABLED`；生产：院方 OIDC | 生产从 OIDC/SecretProvider 注入，不写文档 | 开发免登录只用于联调，不能作为生产配置 |

> DolphinScheduler 的服务账号密码登录回退已关闭。Token 轮换器每 24 小时轮换，当前/上一枚
> Token 保留 30 分钟交叠窗口；控制面只读 Secret 卷。不要把 Token 写入任务 JSON、浏览器书签、截图、日志或 Git。

## 4. 在开发机查询凭据的安全方式

先通过公钥登录开发机，再在服务器本地查看受保护文件；不要在本地 shell 历史、聊天窗口或 CI 日志中复制秘密值：

```bash
ssh root@172.16.65.59
cd /root/data-os-dev-20260803

# 只查看，不修改；确认权限为 0600
stat -c '%a %n' .env
less .env

# 查看服务状态（不会输出 .env 的值）
docker compose ps
docker compose -f docker-compose.yml -f dolphinscheduler/docker-compose.yml \
  --profile scheduler ps

# 查看调度器 Secret 卷中的文件名和权限，不打印 Token 内容
docker volume inspect data-os-dev-scheduler-token-secrets
```

如果需要临时修改配置，使用 `sudoedit /root/data-os-dev-20260803/.env`，完成后再次执行：

```bash
chmod 600 /root/data-os-dev-20260803/.env
```

禁止执行以下操作：

- 将 `.env`、Token 文件或 Docker inspect 的完整环境变量粘贴到 Git、工单、截图或群聊；
- 在门户前端、浏览器 localStorage、任务配置 JSON 或日志中保存密码、Secret、Token；
- 使用开发环境账号访问院内真实患者数据；
- 将 `172.16.65.59` 的 SSH 密码写入仓库。当前交付只支持公钥认证。

## 5. 常用健康检查

```bash
curl -fsS http://172.16.65.59:18081/healthz
curl -fsS http://172.16.65.59:18081/api/v1/system/status
curl -fsS http://172.16.65.59:18082/overview
curl -fsS http://172.16.65.59:18083/dolphinscheduler/actuator/health
curl -fsS http://172.16.65.59:19000/health
```

验证门户技术入口时使用 `/operations`。DolphinScheduler `18083` 的根路径不是门户，访问 `/` 返回 404
不代表服务故障；浏览器应使用上表中的 `/dolphinscheduler/ui/` 路径。

## 6. 生产交接要求

部署到院内或区域生产环境前，必须另建一份仅存于院方受控文档库的私密登记单，至少填写：

1. 命名租户、OIDC issuer/audience、技术角色和服务账号负责人；
2. LIS、EMR、手术系统的只读账号、凭据轮换人、来源地址白名单和前置机位置；
3. Doris FE/BE 地址、ODS/质量审计库、三类最小权限账号及轮换周期；
4. RustFS/S3 endpoint、bucket、访问密钥来源、SSE-S3 主密钥托管方式；
5. 院方通知网关 URL、签名密钥来源、回执地址和联系人；
6. 离线镜像包、SeaTunnel 连接器包、校验和、签名公钥和回滚包位置。

生产私密登记单不得回填本文件，也不得随应用镜像、前端静态包或 CI 制品发布。生产配置模板见
[`deploy/production/.env.example`](../deploy/production/.env.example)，其中所有 `replace-with-*`
均必须由院方 SecretProvider 或受控部署流程注入。

如果院方确实要求把实际值整理成“私密文档”，请在受控机器上另建
`docs/environment-access-reference.local.md`，设置 `chmod 600` 后填写；仓库根目录的
`.gitignore` 已忽略 `docs/*-local.md`，提交前仍必须用 `git status` 和敏感扫描复核，不能把该文件
推送到远程仓库。
