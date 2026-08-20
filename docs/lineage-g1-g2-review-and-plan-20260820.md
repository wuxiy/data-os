# 血缘真实化方案（G1 OpenMetadata 摄取 + G2 血缘 BFF 与门户接真）— 2026-08-20

目标：把门户「数据资产/血缘」从静态演示改为真实链路——OpenMetadata 摄取 Doris `ods_ep`（G1，组件侧锚点，对应 gate-hospital-edge L5.1/L5.2/L5.3），control-plane 提供 OpenMetadata 适配 BFF，门户资产页接真（G2）。G4（嵌入式 Superset 分析页）另案实施，本文只留接口。

## 一、现状事实（2026-08-20 全部实测）

| # | 事实 |
| --- | --- |
| 1 | OpenMetadata server 1.5.11（`medical-platform-openmetadata-1`）健康运行 2 周+；后端 MySQL（`medical-platform-mysql-1`），搜索走 Elasticsearch；经网关 8445 暴露（`/api/v1/...`）。server 容器为纯 Java 运行时，**无内置 Python 摄取**（`PIPELINE_SERVICE_CLIENT_ENABLED=false`，无 Airflow/ingestion 常驻） |
| 2 | `openmetadata/ingestion:1.5.11` 镜像已在开发机（6.47GB）；`metadata.ingestion.source.database.doris`（DorisSource）可用；ingestion 容器在 `medical-platform_platform-net` 内可解析 `openmetadata`（172.20.0.10）、`superset`（172.20.0.5） |
| 3 | OpenMetadata 已有两个数据库服务，均为 data-ops 遗留：`doris-medical`（serviceType=Doris，**root 账号**，零表）、`doris-via-mysql`（Mysql 类型，17 张 `medical_platform*` 演示库表）。**`ods_ep` 尚未被任何服务摄取** |
| 4 | OM 认证 = Keycloak custom-oidc（realm `data-platform`）。本轮已建**专用 confidential client `dataos-om-ingest`**（service account + 硬编码 claim `preferred_username=ingestion-bot`），client_credentials 签发 token 实测可调 OM API 全量读写（ingestion-bot 在 `AUTHORIZER_INGESTION_PRINCIPALS` 内）。口令零落盘：client secret 存开发机 `/root/.om-ingest-client-secret`（0600），token 现用现签 |
| 5 | Doris `ods_ep` 现有 3 表：`ep_mz_cfzb`（处方主表 11,373 行）、`ep_mz_cfzb_inc`（UNIQUE KEY 增量表）、`ep_mz_ypcfmx`（药品明细）。`dataos_quality_ro` 只读账号可见 `ods_ep`（另有 `dataos_quality_acceptance`/系统库；**不可见** `dataos_mpi`——MPI 独占账号设计未被破坏） |
| 6 | 门户现状：`AssetCatalogPage`（目录 + 血缘/质量 Tab）与 `AssetTechnicalPage`（结构/血缘/同步证据）全部读 `data/mock` 静态数据；无任何 controlPlane 血缘 API |
| 7 | Superset 4.1 内嵌仪表盘 id=2（spike 已验嵌入可行）：图表→数据集→`ods_ep.ep_mz_cfzb` 链存在于 Superset 内，但 OM 侧无 Superset 摄取，血缘不可见 |

## 二、设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | **新建 OM 服务 `doris-dataos`**（serviceType=Doris，`dataos_quality_ro` 只读账号），不复用遗留 `doris-medical`/`doris-via-mysql` | 遗留服务用 root 账号（违反最小权限）且属于 data-ops 时代命名空间；新服务让 data-os 的元数据面与遗留资产物理分开，G2 BFF 查询面收敛在自有服务；遗留服务保留不动（历史资产，不删除） |
| D2 | 摄取范围限 `ods_ep` 一库（schemaFilterPattern includes） | G1 验收口径即 L5.1/L5.2（EP 资产）；`dataos_quality_acceptance`（合成验收数据）与 `dataos_mpi`（MPI 事务态，账号也不可见）不进资产目录，避免把实验/敏数据混入演示口径。后续按需扩 |
| D3 | **不跑 profiler / 数据采样**（纯结构元数据摄取） | 演示档不需要行数分布；「摄取只读元数据、不触碰患者数据」与 G3 安全口径一致（列名不是 PHI，采样值是） |
| D4 | 摄取执行形态：**一次性容器** `docker run --rm --network medical-platform_platform-net openmetadata/ingestion:1.5.11 metadata ingest -c <yaml>`；整套动作收进幂等脚本 `deploy/scripts/om-ingest-ods-ep.sh`（建/更新服务 + 签 token + 摄取 + 摘要对账），脚本与 yaml 模板进 Git，口令从开发机 `.env`/0600 文件读，**零口令入 Git** | 不引入常驻 ingestion 容器/Airflow（最小变更）；可重复执行（幂等 = OM 按全限定名 upsert）；脚本化让 G5 复验时可一键重跑 |
| D5 | Superset 摄取（L5.3）：跑 OM `superset` source 一次性容器，范围限 spike 仪表盘所在站点；若跨服务血缘（chart→dataset→`doris-dataos.ods_ep.*`）解析不到（OM 1.5 的 Superset 连接器默认自建 Mysql 服务实体），**如实记录偏差**，不为演示硬造 | L5.3 通过标准是「链可见」；工具行为与预期的差距是验收事实，不是可绕过的配置问题 |
| D6 | G2 BFF 形态：control-plane 新增 `LineageApi`（`/api/v1/assets`、`/api/v1/assets/{fqn}/lineage`、`/api/v1/lineage/summary`），服务身份 = `dataos-om-ingest` client（token 缓存自动续签）；OM 不可达时 503 + 明确错误码（复用既有降级语义），前端 live 模式下显示「待接入」边界而非静态样例 | 与 quality-runner/SeaTunnel 适配器同一模式（BFF + 专用凭据 + 超时降级）；门户不直连 OM（不暴露组件控制台，蓝图「统一门户聚合」口径） |
| D7 | 前端接真范围：资产目录列表（库/表/列数）、表详情（列清单 + 索引等结构证据）、血缘视图（上游/下游节点链）。`runtimeMode` 分流与 MPI 相同：demo 构建走原静态页（保留 DemoDataBoundary），live 构建走 BFF 新组件 | 行为保持型：静态演示链路零回归；真实链路单独组件可单独测试 |
| D8 | dbt/质量层摄取（L5.3 括注项）：**本轮不做**。quality-runner 的 dbt manifest 在镜像内、无留存路径，成本高收益低 | 延后清单，G5 前再评估 |

## 三、实施步骤

### G1（组件侧锚点）

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| G1.1 | 写 `deploy/scripts/om-provision.sh`（幂等：确保 `doris-dataos` 服务存在且连接配置最新）+ `deploy/config/openmetadata/doris-dataos-ingestion.yaml.template`（口令/口令 token 占位） | 脚本进 Git；重复执行结果一致 |
| G1.2 | 执行摄取（一次性容器，`metadata ingest`） | workflow 成功退出；OM API 可查 `doris-dataos.ods_ep.*` 3 张表实体 |
| G1.3 | 对账：OM 表/列清单 vs Doris `SHOW TABLES`/`SHOW COLUMNS` 抽样比对；脚本输出摘要 | 零差异（表数、列名、列类型逐一） |
| G1.4 | Superset 摄取（D5；范围限嵌入试点站点） | 仪表盘/图表实体入 OM；血缘链可达性如实记录 |
| G1.5 | UI 留证：网关 8445 进入 OpenMetadata，截图 `ods_ep` 资产页与血缘页 | 截图归档 `docs/validation/assets/` |
| G1.6 | 验收报告 `docs/validation/gate-lineage-g1-20260820.md`（对照 L5.1-L5.4） | 报告落库 |

### G2（BFF + 门户接真）

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| G2.1 | control-plane：`OpenMetadataClient`（client_credentials 签发 + 缓存 + 过期重签；超时/重试）+ WireMock 契约测试 | 单测覆盖签发/缓存/降级三分支；mvn 全量零修改全绿（新增除外） |
| G2.2 | control-plane：`LineageController`（资产列表/表详情/血缘/摘要四个读 API；OIDC 鉴权与既有面一致） | 契约测试（含 OM 503 → 网关 503 映射、字段裁剪：连接配置/凭据永不返回） |
| G2.3 | 门户：`data/lineageApi.ts` + `AssetCatalogLive`/`AssetTechnicalLive` 组件；`runtimeMode` 分流 | `npx tsc -b` + vitest + qa（mock-audit / portal-interactions-smoke）全绿 |
| G2.4 | 远端联调：部署 control-plane 新镜像 + portal，浏览器验证真实资产/血缘呈现；截图 | 截图归档；既有页面零回归 |
| G2.5 | 文档：CONTEXT.md 增补血缘域术语（如「资产」「血缘锚点」）；AGENTS.md 若涉及命令则补 | 评审口径一致 |

## 四、验收清单（G1，对照 gate-hospital-edge L5）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| A1 | 资产摄取（L5.1） | OM 配置 Doris 连接（`doris-dataos`，只读账号），`ods_ep` 3 表元数据入库 |
| A2 | 资产可查（L5.2） | OM 中表 schema、列清单与 Doris 实际结构抽样一致（逐列比对） |
| A3 | 血缘呈现（L5.3） | Superset 摄取后图表→数据集→`ods_ep` 表链可见（或如实记录解析偏差） |
| A4 | 入口留证（L5.4） | 网关 8445 访问截图；门户血缘页在 G2 完成前保持静态边界如实标注 |
| A5 | 权限 | 摄取账号仅 SELECT（`dataos_quality_ro`）；OM 凭据不落 Git/日志；新 Keycloak client 仅服务间使用 |
| A6 | 回归 | 既有 OM 服务/资产零删除；data-os 其余链路（控制面/质量/MPI）零变更 |

## 五、延后清单

- `dataos_quality_acceptance`、`dataos_mpi` 库的资产纳入（按需）
- dbt/质量层血缘（D8）
- OM 摄取编排进控制面「外部运行」统一状态机（现为脚本触发）
- Superset 嵌入与 OM 的「图表↔资产」互跳（G4 一起设计）
- Doris root 账号在遗留服务 `doris-medical` 中的收敛（换只读或下线该服务，涉及 data-ops 遗留资产处置，单独决策）
