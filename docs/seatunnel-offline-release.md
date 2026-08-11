# SeaTunnel 院方离线制品与单院执行器

本项目第一版临床批处理链路使用固定版本的 SeaTunnel 2.3.13，镜像只包含
`connector-jdbc` 与 `connector-doris`，不安装、不挂载 DolphinScheduler Shell
插件。院方环境默认没有互联网，正式交付物是可校验、可拷贝、可回滚的
`linux/amd64` 单机执行器包；院内 OCI 仓库只作为导入离线包后的可选分发点。

## 制品边界

| 项目 | 约束 |
| --- | --- |
| 运行平台 | Docker Engine 24+、Docker Compose v2.20+、`linux/amd64` |
| 首发连接器 | JDBC source/sink、Doris sink；CDC 连接器另行评审 |
| 驱动 | `driver-manifest.tsv` 固定版本和 SHA-256；JAR 从受控构建输入提供，不提交 Git |
| Oracle | `oracle-enabled` profile，必须由甲方提供授权 JAR 并完成许可证审批 |
| 安全 | 正式包必须有 detached Cosign 签名；私钥只在受控发布机存在 |
| 运行语义 | 单节点批处理；控制面持久化作业水位和稳定批次号；目标表用 UNIQUE KEY/UPSERT 实现重放幂等；不宣称 HA/CDC/exactly-once |

SeaTunnel 的 JDBC 连接器和数据库驱动是两类依赖：连接器通过固定 Maven
制品纳入镜像，数据库厂商驱动通过清单和许可证边界注入镜像。这里不允许
生产容器启动后从互联网下载插件或驱动。

## 构建输入和镜像

在受控的 `linux/amd64` 发布机上准备：

```bash
export SEATUNNEL_DRIVER_PROFILE=postgresql
export SEATUNNEL_DRIVER_DIR=/path/to/controlled-jars
export SEATUNNEL_CONNECTOR_DIR=/path/to/connector-cache
export SEATUNNEL_IMAGE_TAG=medical-platform/data-os-seatunnel:2.3.13-dataos.2
deploy/seatunnel/scripts/build-image.sh
```

`SEATUNNEL_CONNECTOR_DIR` 可包含 SeaTunnel 官方 tar、`connector-jdbc-2.3.13.jar`
和 `connector-doris-2.3.13.jar`。若三者都已准备好，可设置
`SEATUNNEL_OFFLINE_BUILD=true`，构建过程不会下载业务制品；基础镜像和 Alpine
系统包必须已经在受控构建机缓存或内部镜像中；每个文件都会按
`manifest.env`/`driver-manifest.tsv` 校验 SHA-256 或 SHA-512。无缓存时只允许
受控构建机按清单下载，不能把下载动作带入院内运行时。

可选驱动 profile：

- `postgresql`：注入 PostgreSQL JDBC 驱动以及 Doris catalog 所需的 MySQL JDBC 驱动，适合首个合成验证和大多数院内批处理；
- `standard`：注入 PostgreSQL、MySQL、SQL Server 驱动；
- `oracle-enabled`：在 `standard` 基础上要求受控目录中存在甲方授权的 `ojdbc11`；
- `none`：只用于不连接数据库的镜像检查，不可用于临床 JDBC 工作流。

## 生成离线包

开发验证包允许不签名，但只能在隔离开发环境显式放行：

```bash
deploy/seatunnel/scripts/package-offline.sh \
  --image "$SEATUNNEL_IMAGE_TAG" \
  --output dist/data-os-seatunnel-2.3.13-linux-amd64
DATAOS_ALLOW_UNSIGNED=true \
  deploy/seatunnel/scripts/verify-offline-bundle.sh \
  --bundle dist/data-os-seatunnel-2.3.13-linux-amd64 --allow-unsigned
```

包内包含镜像归档、`release-manifest.json`、SHA-256 清单、CycloneDX SBOM、
SeaTunnel/第三方许可证、生产本地/外部集群 Compose overlay、配置和导入/激活/
回滚脚本。生产包必须在受控发布机执行：

```bash
export DATAOS_RELEASE_SIGNING_KEY=/secure/release/data-os-cosign.key
deploy/seatunnel/scripts/package-offline.sh \
  --production --image "$SEATUNNEL_IMAGE_TAG" \
  --output dist/data-os-seatunnel-2.3.13-linux-amd64
```

`package-offline.sh --production` 在没有私钥、Cosign 或 SBOM 工具时直接失败；
仓库和输出包均不包含私钥。签名文件是 `SHA256SUMS.sig`，离线验签需要把受控
公钥通过 `--public-key` 或 `DATAOS_RELEASE_PUBLIC_KEY` 提供给目标环境。

## 院内无互联网安装

通过受控介质把整个包目录复制到部署机，先验收再激活。验证/导入不会自动重启
生产服务：

```bash
bundle=/opt/release/data-os-seatunnel-2.3.13-linux-amd64
deploy/seatunnel/scripts/verify-offline-bundle.sh \
  --bundle "$bundle" --public-key /etc/data-os/release.pub
deploy/seatunnel/scripts/load-offline-bundle.sh \
  --bundle "$bundle" --public-key /etc/data-os/release.pub
```

导入后可由院方镜像管理员将已验证的镜像重新打入院内 OCI 仓库；重新打标签不
改变包内原始镜像 ID 和签名清单，生产 `.env` 应改为仓库的不可变 digest。
如需通过 `activate.sh` 激活该私有仓库引用，在变更窗口额外设置
`DATAOS_ACTIVATION_IMAGE=registry.example.invalid/data-os/seatunnel@sha256:...`；脚本
只接受与签名清单 `imageId` 完全一致的已导入镜像，不能借此替换制品内容。

## 单院激活和回滚

本地 SeaTunnel 模式在 `deploy/production/seatunnel-compose.yml` 中启动一个
单节点 executor；已有院内 SeaTunnel 集群则只使用
`seatunnel-external-compose.yml`，不启动本地容器。两者都把
`SEATUNNEL_BASE_URL` 注入控制面。

```bash
DATAOS_ACTIVATE_CONFIRM=YES \
  deploy/seatunnel/scripts/activate.sh \
  --bundle "$bundle" \
  --compose-root /opt/data-os/deploy/production \
  --env-file /opt/data-os/deploy/production/.env
```

脚本先验签、检查镜像为 amd64、运行 `docker compose config --quiet`，再备份旧
配置、完整环境文件和镜像引用到 `.data-os-seatunnel/backups/<UTC时间>/`，把新镜像
引用持久化到 `.env`，最后只启动
`seatunnel-master` 和控制面，不删除任何数据卷。回滚同样需要变更确认：

```bash
DATAOS_ROLLBACK_CONFIRM=YES \
  deploy/seatunnel/scripts/rollback.sh \
  --compose-root /opt/data-os/deploy/production \
  --env-file /opt/data-os/deploy/production/.env
```

单节点 checkpoint、日志和工作目录使用命名卷。首版合同中的
`${last_success_time}` 由控制面在提交前从 `data_os.ingestion_checkpoints` 注入，`${run_start_time}`
作为本批次提取上界；成功批次才推进到该上界，失败/阻塞批次从上次成功水位重放。控制面将稳定 `dataos_run_id` 写入任务环境和 HTTP
幂等请求头，不能据此把跨系统语义升级为 exactly-once。需要自动故障转移、CDC、跨院多活时，应切换到独立 SeaTunnel
集群方案并重新评审恢复语义。

## 版本升级验收

每次版本升级至少保留以下证据：镜像架构和 digest、SHA-256 清单与 Cosign 验签、
SBOM/许可证、SeaTunnel `/overview` 健康检查、合成 PostgreSQL→Doris 首次写入、
相同批次重跑后的 UPSERT 结果、失败批次水位未推进、容器日志不含数据库口令。
没有真实医疗端点、账号或样本时，交付记录必须标为“合成验收”，不能宣称已经
接入真实 LIS/EMR/手术系统。

包内 `scripts/smoke-jdbc-doris.sh` 只接受环境变量形式的临时测试凭据，生成的
SeaTunnel 配置位于权限受限的临时目录，脚本输出不会打印密码或 SQL；它要求
调用者事先创建合成源表和 Doris 目标表。当前开发机已完成同一镜像的
PostgreSQL→Console JDBC 作业（2 行读取、2 行提交、`FINISHED`），但开发环境
当前没有可达 Doris FE，因此 PostgreSQL→Doris 和 UPSERT 重跑证据仍是待办，
不能把前者冒充后者。开发阶段可先使用 `deploy/dev/replay-source` 的无 PHI HTTP fixture
验证字段合同和水位替换；真实端点交接后必须重新执行本验收。
