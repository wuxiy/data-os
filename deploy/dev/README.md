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

## 验收

```bash
curl -fsS http://127.0.0.1:18081/healthz
curl -fsS http://127.0.0.1:18081/api/v1/governance/summary
curl -fsS http://127.0.0.1:18081/api/v1/sources
curl -fsS http://127.0.0.1:18082/overview
```

浏览器访问 `http://开发机地址:18081/`。治理驾驶舱顶部显示“控制面已连接”时，指标与问题来自复用 PostgreSQL 的 `data_os` schema；控制面不可用时，前端保留演示数据并明确标识降级状态。

## 回滚

只停止新增服务即可，不会影响 data-ops：

```bash
docker compose -f docker-compose.yml --profile executor down
docker compose -f docker-compose.yml down
```

这不会删除 PostgreSQL 数据卷，也不会删除 `data_os` schema。若要回滚数据变更，需按发布记录执行对应 SQL，禁止在开发机上直接删除共享数据库。
