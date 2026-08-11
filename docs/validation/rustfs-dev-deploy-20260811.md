# RustFS 与质量运行器开发演示部署记录（2026-08-11）

## 目标与范围

在开发服务器 `root@172.16.65.59` 的 `/root/data-os-dev-20260803` 部署 RustFS 单节点对象存储，并将质量运行器、控制面和门户切换到本轮可交付镜像，用于院内演示。部署复用既有 PostgreSQL、Doris、SeaTunnel 和 DolphinScheduler，不删除既有业务容器或数据卷，也不恢复 Shell 插件。

部署前回滚快照：

`/root/data-os-dev-20260803/rollback-pre-rustfs-20260811-1336`

快照包含 `.env`、Compose、Nginx、门户静态包、容器清单、卷清单和校验和；远程 `.env` 权限为 `0600`，本记录不保存任何访问密钥。

## 部署内容

- RustFS 使用固定镜像 digest `sha256:41fe89380f4120a337790c02af192c3fe7bb55c3edc2e6e9357b487b47c6ab21`，数据持久化到 Docker volume `data-os-dev-rustfs-data`。
- S3 API 映射到 `19000`，Console 映射到 `19001`；健康检查使用 `/health`。
- `rustfs-init` 复用质量运行器镜像，以幂等方式创建 `dataos-quality-artifacts` 桶，不新增 MinIO 客户端或其他中间件。
- RustFS 配置了 Base64 编码的 32 字节 SSE-S3 主密钥；访问密钥、Secret 和主密钥仅写入远程 `.env`。
- 质量运行器镜像为 `medical-platform/data-os-quality-runner:0.1.0-four-gates-72bfc20-r2`，复用开发机已有 dbt 依赖层，仅更新本轮应用、规则和 dbt 工程；构建上下文已清除 macOS AppleDouble 旁路文件。
- 控制面镜像为 `medical-platform/data-os-control-plane:0.1.0-four-gates-72bfc20`；SeaTunnel、DolphinScheduler 和通知接收器保持既有运行实例。
- 门户挂载使用 SELinux `:Z` 标记，避免开发服务器上新静态目录被 Nginx 读取为 403。

## 验收结果

| 检查项 | 结果 |
| --- | --- |
| RustFS 容器 | `healthy`，`/health` 返回 `{"status":"ok","ready":true}` |
| RustFS Console | `http://172.16.65.59:19001/rustfs/console/` HTTP 200；当前 beta 镜像根路径是 S3 路由，直接访问 `/` 返回 `AccessDenied` 属于预期行为 |
| `rustfs-init` | `Exited (0)`，日志为 `RustFS bucket ready: dataos-quality-artifacts` |
| S3 桶访问 | 质量运行器容器内 `list_buckets` 返回 `dataos-quality-artifacts` |
| 质量运行器 | `healthy`，`/readyz` 返回 `{"status":"UP"}` |
| 控制面/门户 | 控制面 `healthy`；门户 `/`、`/healthz` 和 JS bundle 均 HTTP 200 |
| 既有执行器 | SeaTunnel `/overview`、DolphinScheduler、通知接收器保持运行；未启用 Shell 插件 |
| 质量闭环 | 使用合成 Doris 数据提交 `demo-rustfs-1786429411`，dbt 通过、回写 `SUCCEEDED/passed=true`，制品写入 `s3://dataos-quality-artifacts/quality-runs/t_bd0dbdf57105f65059/demo-rustfs-1786429411/summary.json` |

首次演示运行发现 Doris 表名限制：完整租户命名空间与规则名拼接后超过 64 字符。已将运行器租户哈希命名空间收敛到 18 位，并以 `-r1` 镜像重启后复检通过；随后清理构建上下文旁路文件并升级为最终 `-r2` 镜像再次复检通过。该修复保留 72 位租户/机构命名空间熵，不改变业务数据。

## 演示入口

- 门户：`http://172.16.65.59:18081/`
- RustFS S3：`http://172.16.65.59:19000`
- RustFS Console：`http://172.16.65.59:19001/rustfs/console/`
- SeaTunnel：`http://172.16.65.59:18082/`
- DolphinScheduler API：`http://172.16.65.59:18083/`

RustFS 镜像、命令和健康端点遵循[官方 Docker 部署说明](https://docs.rustfs.com/en/installation/container/docker)；开发环境仍是单节点、HTTP、无 TLS，不得直接作为生产部署配置。生产环境应使用院方离线制品/镜像仓库、独立密钥、TLS 终止、命名租户和真实通知端点。

## 未覆盖边界

本次验收使用无患者信息的合成 Doris 数据，证明的是平台→dbt→RustFS 制品闭环，不代表真实 LIS/EMR/手术系统端点、Doris ODS 表或院方消息网关已接入。开发控制面仍显式保留 `DEMO` 展示种子和免登录联调配置；生产不得复用该 `.env`。
