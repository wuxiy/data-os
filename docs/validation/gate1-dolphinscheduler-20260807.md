# Gate 1 DolphinScheduler 验证记录（2026-08-07）

## 验证范围

本次验证覆盖控制面 DolphinScheduler 适配器、DolphinScheduler 开发/生产 Compose overlay、最终控制面制品和门户回归。远程开发机只做只读连通性检查；没有在远程数据库、任务或容器上写入数据。

## 本地结果

| 检查项 | 结果 |
| --- | --- |
| 控制面 Maven `clean package` | 通过，61 tests，failures/errors/skipped 均为 0 |
| 最终 JAR 内容 | 已包含 `DolphinSchedulerExecutorAdapter`、`OrchestratorAdapter` |
| 开发 Compose + DS overlay | `docker compose config --quiet` 通过 |
| 生产 Compose + DS overlay | `docker compose config --quiet` 通过 |
| 门户生产构建 | `npm run build` 通过 |
| mock 边界审计 | `npm run qa:mock` 通过 |
| 门户交互 smoke | `node qa/portal-interactions-smoke.mjs` 通过 |
| 前端生产依赖审计 | npm 官方 registry，0 vulnerabilities |
| `git diff --check` | 通过 |

本地 Docker 镜像构建已实际触发，但因 OrbStack 拉取 `eclipse-temurin:21-jre-alpine` 时 Docker Hub 认证请求网络超时而未完成；不是 Dockerfile 或 Java 构建错误，CI Linux runner 仍会执行镜像构建、Trivy 和 SBOM 门禁。

## 远程开发机只读检查

目标地址 `172.16.65.59` 的 TCP/22、HTTP `18081` 和 HTTPS `8443` 均可达：

- `http://172.16.65.59:18081/healthz` 返回 `200`、`{"status":"UP"}`。
- `https://172.16.65.59:8443/` 返回门户 HTML `200`。
- `GET /api/v1/system/status` 返回当前远程实例仍为 `DEMO` 模式，演示种子和 DEMO 质量执行器已开启；这属于既有开发环境状态，不是本次 Gate 1 生产配置。
- `18083`、`19083` 和 `12345` 均未发现 DolphinScheduler API 监听，因此本轮不能声称远程调度器已部署或完成真实工作流验收。

SSH 端口可达，但当前会话提供的账号凭据被远端拒绝，无法执行远程文件同步、Compose 启停或容器日志检查。待提供可用 SSH 密钥/凭据后，按 `deploy/dev/README.md` 的 overlay 步骤部署，并补做“发布工作流 → 提交 → `ds|project|workflow|instance` 状态回写”的真实验收。

## 已知边界

控制面会把 data-os 运行编号写入 DolphinScheduler `startParams.dataos_run_id`，但 DolphinScheduler 3.4.x 的公开实例列表 API 不能按该参数做可靠唯一对账。提交响应超时会进入 `BLOCKED_DEPENDENCY`，不会自动重试；运维人员必须先在 DolphinScheduler 侧核对实例，避免重复采集。跨系统幂等对账列为 Gate 1 P1，不把当前能力宣称为 exactly-once。
