# Gate 1 远程开发环境部署记录（2026-08-08）

> 历史验收记录：本文记录的是 2026-08-08 早期隔离 Shell 烟囱实验，仅用于保留调度器适配链路的故障证据和回滚参考。当前版本已移除 Shell 插件安装/挂载，历史 `dataos_gate1_shell_*` 定义已归档；临床工作流改由 SeaTunnel 的 LIS/EMR/手术系统连接器合同承接，不能按本文的 Shell 步骤作为现行部署指引。

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
- 复检发现 DolphinScheduler 3.4.1 官方运行时镜像不包含任务插件依赖；新增 `dolphinscheduler-task-plugin-installer`，从 Maven Central 下载 `dolphinscheduler-task-shell-3.4.1.jar` 并以固定 SHA-256 `d9e5d5d7f2e9c83d4958b267d5c2a668fa9d8fdb6064a7f73bd11f2cd79dca6a` 校验，再以只读卷挂载给 API、Master、Worker。三类服务日志均确认 `Success register task plugin: SHELL`。
- 为单院开发节点补充 `WORKER_TENANT_CONFIG_DEFAULT_TENANT_ENABLED=true`，让 `tenantCode=default` 使用 Worker bootstrap 用户执行；生产 overlay 默认关闭，要求配置真实命名租户。

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
| 服务 token 认证 | 携带 token 请求 `/projects/created-and-authed` 返回 HTTP 200、DolphinScheduler `code=0` |
| SHELL 插件加载 | API、Master、Worker 均输出 `Success register task plugin: SHELL`；插件文件 SHA-256 与部署清单一致 |
| 最小工作流创建/发布 | 项目 `dataos_gate1_e2e_20260808`（code `180931789157120`），工作流 `dataos_gate1_shell_20260808`（code `180932865356288`），创建与发布均返回 `code=0` |
| data-os 真实提交与回写 | 运行 `ds|180931789157120|180932865356288|3` 回写 `SUCCEEDED`；DolphinScheduler 实例/任务均为 `SUCCESS`，Shell 日志输出 `DATAOS_GATE1_WORKFLOW_OK` |
| 相同幂等键重复提交 | 两次请求返回同一 data-os run `e2a1af9c-c57a-462b-99a8-19f11b6aff7d` 和同一外部实例 `...|4`，未新增第二个实例；最终状态 `SUCCEEDED` |

控制面重建后曾出现 Nginx 缓存旧控制面容器 IP 导致 502；重启 Portal 重新解析 `control-plane` 服务名后，健康检查和系统状态恢复 200。该操作只重启无状态 Portal 容器。

## 当前边界与后续动作

本次已完成隔离项目/工作流的创建、发布、data-os 任务提交、DolphinScheduler 执行、状态轮询回写和相同幂等键重放验证。过程中保留了两条插件缺失/租户配置缺失导致的失败运行（外部实例 `...|1`、`...|2`）作为故障证据；成功运行使用 `...|3`、`...|4`。该验证证明调度器适配链路可用，不等同于真实 LIS/EMR 生产采集链路已验收。

后续交付前仍需由实施人员把项目/工作流绑定替换为院方审核过的真实工作流，并按生产环境关闭 `default` 租户回退、配置命名租户和短周期凭据。当前可重复执行的租户与历史工作流归档步骤见 `deploy/dolphinscheduler/clinical-tenant-migration.sql` 及生产/开发 provisioning 脚本。

开发环境仍显示 `notificationConfigured=false`、质量执行器为 DEMO，这是既有开发配置，不是本次调度器故障。2099 长有效期 token 仅用于当前开发机快速验收，生产必须改为短周期专用 token、密钥文件/Secret 管理和轮换策略，并禁用或轮换默认管理员口令。若后续为非临床技术工作流单独启用任务插件，必须在对应 overlay 中固定版本和校验值；当前临床路径不能以 Shell 插件或 API health 作为业务验收。
