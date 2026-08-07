# Gate 1 远程开发环境部署记录（2026-08-08）

## 目标与范围

在 SSH 公钥认证可用后，将 Gate 1 控制面制品和 DolphinScheduler 单院 overlay 部署到开发机 `root@172.16.65.59`，验证容器健康、控制面内部连通、Portal 代理和调度器服务账号认证。此次操作不删除既有容器或数据卷，不执行 data-os 业务数据迁移。

远程工作目录为 `/root/data-os-dev-20260803`。部署前创建回滚快照：

`/root/data-os-dev-20260803/rollback-pre-dolphinscheduler-20260808-000348`

快照包含原 `.env`、Compose、Nginx 配置、控制面 JAR/Dockerfile、容器和镜像 inspect 信息及校验和；没有输出任何密钥值。

## 部署动作

- 传入并校验控制面最终 JAR、非 root Dockerfile、开发 Compose、DolphinScheduler overlay 和 JDBC Registry 初始化 SQL。
- 远程构建 `medical-platform/data-os-control-plane:0.1.0-ds-gate1`，镜像 manifest digest 为 `sha256:f0fea8d78c517b00dbbd7c9fb4ee43b518e695d23d7c983429f895bbd265186e`。
- 通过独立的 `data-os-dev-dolphinscheduler-postgresql` 数据卷运行 DolphinScheduler 3.4.1；Registry 表与官方主 Schema 初始化均成功退出（exit 0）。
- DolphinScheduler API、Master、Worker、Alert 使用 JDBC Registry，不启用 ZooKeeper；API 映射到开发机 `18083`。
- 首次拉取 Docker Hub 镜像时发现远程 Docker 镜像加速器返回 `Host doesn't match` 并触发层清理超时。已停止异常并逐个从可达的 `docker.1ms.run` 拉取后按官方镜像名重标记；未修改 `/etc/docker/daemon.json`，未重启 Docker，也未影响既有服务。
- 使用一次性管理员会话创建 `dataos_scheduler` 服务账号（DolphinScheduler 用户 id 2），生成有效期至 2099-12-31 的开发 token；token 只写入远程 `.env`（权限 600），没有写入任务配置、日志、Git 或本记录。控制面改用 token，用户名/密码回退项保持为空。

## 远程验收结果

| 检查项 | 结果 |
| --- | --- |
| `dolphinscheduler-postgresql` | `healthy` |
| Registry 初始化容器 | `Exited (0)` |
| 主 Schema 初始化容器 | `Exited (0)`；官方 SQL 完整执行 |
| API / Master / Worker / Alert | 均为 `running (healthy)` |
| `http://127.0.0.1:18083/dolphinscheduler/actuator/health` | HTTP 200，API 与 PostgreSQL 均 `UP` |
| 控制面容器 | `medical-platform/data-os-control-plane:0.1.0-ds-gate1`，`user=dataos`，health `healthy` |
| 控制面容器内访问 DS | 通过 `http://dolphinscheduler-api:12345/.../actuator/health` 返回 `UP` |
| Portal `/healthz` | HTTP 200，`{"status":"UP"}` |
| Portal `/api/v1/system/status` | HTTP 200；既有开发 DEMO/演示种子/DEMO 质量执行器状态保持不变 |
| 服务 token 认证 | 携带 token 请求 `/projects/created-and-authed` 返回 HTTP 200、DolphinScheduler `code=0`，当前项目数为 0 |

控制面重建后曾出现 Nginx 缓存旧控制面容器 IP 导致 502；重启 Portal 重新解析 `control-plane` 服务名后，健康检查和系统状态恢复 200。该操作只重启无状态 Portal 容器。

## 当前边界与后续动作

本次部署完成了调度器运行时、数据库 Schema、服务账号/token 和控制面网络连接，但新建的 DolphinScheduler 数据库尚无项目和已发布工作流，因此没有伪造“真实采集工作流提交/状态回写”结论。要完成完整端到端验收，还需由调度管理员：

1. 创建项目并发布最小可运行工作流；
2. 在 data-os 任务中保存经审核的 `projectCode`、`workflowDefinitionCode` 绑定；
3. 用该任务执行一次提交、轮询和 `ds|project|workflow|instance` 状态回写。

开发环境仍显示 `notificationConfigured=false`、质量执行器为 DEMO，这是既有开发配置，不是本次调度器故障。2099 长有效期 token 仅用于当前开发机快速验收，生产必须改为短周期专用 token、密钥文件/Secret 管理和轮换策略，并禁用或轮换默认管理员口令。
