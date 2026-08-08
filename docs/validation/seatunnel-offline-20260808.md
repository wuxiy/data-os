# SeaTunnel 离线执行器验证记录（2026-08-08）

## 验证范围

本轮验证固定的 SeaTunnel 2.3.13 amd64 镜像、JDBC/Doris 连接器注入、离线包
校验/导入脚本、单院开发 Compose 切换，以及控制面 credentialRef 到 SeaTunnel
的真实提交闭环。所有数据均为开发机上新建的两行合成 PostgreSQL 数据，不含真实
LIS、EMR、手术系统数据。生产未启动、未写入。

## 制品和镜像

| 检查项 | 结果 |
| --- | --- |
| SeaTunnel 版本 | 2.3.13 |
| 构建输入 | 开发机已有 Apache 官方 tar，SHA-512 与 `deploy/seatunnel/manifest.env` 一致 |
| 连接器 | `connector-jdbc-2.3.13.jar`、`connector-doris-2.3.13.jar`，均按清单 SHA-256 校验 |
| 驱动 | PostgreSQL 42.7.5、MySQL Connector/J 8.4.0，均按 `driver-manifest.tsv` SHA-256 校验；MySQL 驱动用于 Doris catalog 初始化 |
| 远程镜像 | `medical-platform/data-os-seatunnel:2.3.13-dataos.2`，`linux/amd64`，镜像 ID `sha256:b781c26c22c9ae7b990ce61b61b1fc186c5832b5aad09c129503d361c6171530` |
| Shell 插件 | 未安装；镜像/包校验脚本会拒绝发现 Shell 连接器 |
| 执行器健康 | `GET http://127.0.0.1:18082/overview` 返回 `projectVersion=2.3.13`、`workers=1` |

## 脚本验收

- `sh -n deploy/seatunnel/scripts/*.sh` 通过，脚本均可执行。
- 未签名开发包可在显式 `--allow-unsigned` 下通过 SHA-256 校验和 `docker load`；
  未显式放行时返回退出码 `78`，生产 `--production` 没有 Cosign 私钥会 fail-closed。
- `activate.sh` 没有 `DATAOS_ACTIVATE_CONFIRM=YES` 时返回退出码 `77`，不会修改
  Compose 或重启服务。
- `docker load` 后检查到 JDBC/Doris JAR 和 PostgreSQL 驱动，未发现 Shell 插件。

## 真实合成运行

1. 在 `medical-platform_platform-net` 启动临时 PostgreSQL 容器，创建 `source_rows`
   表并写入 2 行测试记录。
2. 直接调用 SeaTunnel `/submit-job` 执行 `Jdbc → Console`：作业 ID
   `1138464766050959361`，状态 `FINISHED`，`SourceReceivedCount=2`、
   `SinkCommittedCount=2`；验证使用的是包含 MySQL Doris catalog 驱动的新镜像。
3. 通过 data-os `/api/v1/credentials` 保存临时凭据，任务 JSON 只保存
   `credentialRef`；再由 `/api/v1/jobs/{id}/runs` 提交同一 JDBC→Console 配置。
   控制面运行 ID 为 `32bc5778-be75-41bc-83b1-a134215a087f`，最终状态
   `SUCCEEDED`。
4. 控制面和 SeaTunnel 日志均未出现合成数据库密码；SeaTunnel `/overview` 显示
   `finishedJobs=2`、`failedJobs=0`。

## 尚未完成与处理方式

开发机当前没有可达 Doris FE/BE，也没有医院 LIS、EMR 或手术系统端点、账号和脱敏
样本。因此本轮没有伪造 PostgreSQL→Doris 或真实临床验收结论；`scripts/smoke-jdbc-doris.sh`
已作为正式包内的待验脚本，待甲方提供 Doris 地址、目标 ODS 表和受控凭据后，补做
首次写入、同批次重跑 UPSERT、失败水位不推进和容器重启恢复证据。

本轮也没有恢复或安装 DolphinScheduler Shell 插件；调度器历史隔离 Shell 任务继续
按命名租户迁移脚本归档。
