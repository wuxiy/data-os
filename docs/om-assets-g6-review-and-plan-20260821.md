# G6 OM 资产目录补全（edge 表 + quality/mpi 库）方案 — 2026-08-21

目标：把门户「数据资产目录」从「电子处方切片」（G1 口径：ods_ep 3 表）补全为
data-os 自有数据资产的完整地图——`ods_ep`（含 G5 新增 edge 两表）、
`dataos_quality_acceptance`（质量验收库）、`dataos_mpi`（患者主索引库），
三库共 9 表入 OpenMetadata；门户资产页支持库切换。G1 延后清单中「quality/mpi
库资产纳入」与本批一并收口。

> 上游依据：`docs/lineage-g1-g2-review-and-plan-20260820.md` §五延后清单、
> G5 验收报告 `docs/validation/gate-hospital-edge-g5-20260820.md`（edge 两表交付）。

## 一、现状事实（2026-08-21 全部实测）

| # | 事实 |
| --- | --- |
| 1 | Doris（FE 172.16.66.8:9030）data-os 自有库：`ods_ep` **5 表**（`ep_mz_cfzb`/`ep_mz_cfzb_inc`/`ep_mz_ypcfmx` + G5 新增 `ep_mz_cfzb_edge`/`ep_mz_ypcfmx_edge`）、`dataos_quality_acceptance` **1 表**（`quality_sample`）、`dataos_mpi` **3 表**（`mpi_source_identity`/`mpi_candidate_pair`/`mpi_match_result`）、`dataos_quality_audit` **空库**（0 表）。其余为 data-ops 遗留库（`datalake_*`/`medical_platform*`/`cecmid_*` 等 60+） |
| 2 | OM 侧 `doris-dataos` 服务资产现状：`ods_ep` 仅 **3 表**（G1 摄取后未再跑，edge 两表缺位）；`dataos_quality_acceptance`/`dataos_mpi` 零资产。OM server 1.5.11 健康（Up 3 周），ingestion-bot 令牌链路通 |
| 3 | 账号面：`dataos_quality_ro`（`%` 来源，授权 `ods_ep`+`dataos_quality_acceptance` SELECT）为 **quality-runner 容器在用账号**（现行口令在容器 env，不在任何 .env）；`dataos_mpi` 为 mpi-service 专用；`dataos_quality_dbt` 为 dbt 用（G5 授 ods_ep）。**`dataos_quality_ro` 不可见 `dataos_mpi`**（G3 独占账号纪律，未被破坏） |
| 4 | **凭据漂移（实施发现）**：`deploy/.env` 的 `DORIS_PASSWORD` 现值（14 字符）匹配 **Doris root** 而非注释所称 `dataos_quality_ro`；G1 对账脚本按旧语义读它已 Access denied。引用面盘点：`docker-compose.app.yml` 三处（mpi-service/nlp-service/data-api，均为**未部署的占位服务**）+ `docker-compose.dev.yml` dbt 说明——**无活跃消费者** |
| 5 | BFF：`LineageAssetService.listAssets(schema)` 已参数化（默认 ods_ep），三库天然可查；`summary()` 硬编码 ods_ep（表数/列数只算一库） |
| 6 | 前端：`AssetCatalogLive` 调 `fetchLineageCatalog(undefined)`（走默认 schema），单库视图无切换；demo 构建静态页（`AssetCatalogPage`）零关联 |

## 二、设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| G6-1 | **新建 Doris 只读账号 `dataos_om_ro`**（`%` 来源），仅授三库 SELECT（`ods_ep`/`dataos_quality_acceptance`/`dataos_mpi`）；OM `doris-dataos` 服务连接换此账号 | 分层调和：OM 摄取身份与业务身份分离（Keycloak 侧先例 = `dataos-om-ingest`）。不动 `dataos_quality_ro`（quality-runner 在用，避免口令重置波及），不动 `dataos_mpi`（mpi-service 专用）；**G3 纪律保持**——`dataos_quality_ro` 仍不可见 mpi 库，元数据可见性经独立账号显式授予 |
| G6-2 | 摄取范围 = 三库（schemaFilterPattern includes），`dataos_quality_audit` 空库与 data-ops 遗留库**不纳入** | 空库无资产可摄；遗留库属 data-ops 时代命名空间（D1/D2 同理，不混入演示口径）。后续审计库有表后按需扩 |
| G6-3 | 摄取仍**纯结构元数据**（无 profiler/无数据采样），D3 纪律延伸至三库 | MPI 表列名不是 PHI，采样值才是；「只读元数据、不触碰患者数据」口径不因扩库而松动 |
| G6-4 | 脚本演进：`om-ingest-ods-ep.sh` → 通用多库脚本（provision + 摄取 + **逐库逐表列对账**），目标库清单进脚本常量；服务 description 同步多库口径 | G1 脚本骨架全复用（幂等 upsert、一次性容器、对账循环参数化）；G6 后该脚本即 data-os 资产面的唯一摄取入口，edge 表补全与 quality/mpi 纳入一次跑完 |
| G6-5 | 口令源：`dataos_om_ro` 口令存开发机 `/root/.doris-om-ro-pw`（0600，与 `.om-ingest-client-secret` 同模式）；脚本不再读 `deploy/.env` 的 `DORIS_PASSWORD` | 隔离事实 #4 的漂移面；零口令入 Git 不变 |
| G6-6 | `deploy/.env` 的 `DORIS_PASSWORD`（root 口令）**本批不动**，处置记录入延后清单（安全收敛：移除或改语义 + root 口令轮换一并做） | 引用面虽为占位，但属跨工程 .env，动它超出本批边界；轮换 root 是独立安全动作（G1/G5 均已建议） |
| G6-7 | BFF `summary()` 扩为多库聚合：schemas 清单进 `OpenMetadataLineageProperties`（默认三库），表数/列数求和；`listAssets` 默认 schema 不变（ods_ep） | summary 是门户「摄取范围/资产数量」证据栏的数据源，单库口径在多库目录下失真；配置化而非硬编码三库，后续扩审计库零代码 |
| G6-8 | 前端资产目录加**库切换**（三个入口：电子处方 ODS / 质量验收库 / 患者主索引），选中库经 `?schema=` 传 BFF；demo 构建零改动 | 行为保持型：live 组件内扩展，静态演示链路与 `DemoDataBoundary` 零回归；MPI/质量资产在目录中可见即「采集→治理→质量→主索引」叙事闭环 |

## 三、实施步骤

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| E1 | 本地：`deploy/config/openmetadata/doris-dataos-ingestion.yaml.template` 扩三库；`deploy/scripts/om-ingest-ods-ep.sh` 多库化（重命名 `om-ingest-doris-assets.sh`，provision 连接参数化账号、对账逐库循环）；新增 `deploy/doris/om-readonly-account.sql`（幂等 CREATE USER + GRANT，root 执行） | 文件进 Git 零口令；shellcheck 级语法过 |
| E2 | 远端：生成随机口令，root 会话建 `dataos_om_ro` + 三库 SELECT 授权；口令落 `/root/.doris-om-ro-pw`（0600） | `SHOW GRANTS FOR dataos_om_ro` 仅三库 SELECT；`dataos_quality_ro`/`dataos_mpi` 授权零变更（前后对比留证） |
| E3 | 远端：跑多库摄取脚本（provision 更新服务连接 → 一次性容器摄取 → 三库对账） | OM 三库 9 表入库；逐表列名对账零差异（Doris `SHOW COLUMNS` vs OM columns） |
| E4 | 代码：BFF `summary` 多库聚合（properties + service + 契约测试）；前端库切换（`lineageApi`/`AssetCatalogLive` + vitest）；`npx tsc -b` + vitest + qa + `npm run build` 全绿；control-plane `mvn test` 全绿 | 既有测试零修改全绿（新增除外） |
| E5 | 远端：构建部署 control-plane 新镜像 + portal；浏览器验证三库切换、edge 表在列、summary 聚合；OM UI 三库截图 | 截图归档 `docs/validation/assets/`；既有页面零回归 |
| E6 | 收尾：gate 报告 `docs/validation/gate-om-assets-g6-20260821.md`；CONTEXT.md 术语补注（如需）；提交推送 main | 报告落库；本地全绿 |

## 四、验收清单（gate）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| A1 | 摄取账号 | `dataos_om_ro` 仅三库 SELECT（grants 留证）；`dataos_quality_ro`/`dataos_mpi`/`dataos_quality_dbt` 授权前后零变更；口令仅存远端 0600 文件，零口令入 Git/日志 |
| A2 | 资产入库 | OM 三库 9 表：`ods_ep` 5（含 edge 两表）、`dataos_quality_acceptance` 1、`dataos_mpi` 3 |
| A3 | 结构对账 | 逐表列名对账零差异；列类型差异（如有）如实记录不阻断 |
| A4 | 门户口径 | live 资产目录三库可切换、列清单正确；summary 表数/列数为三库聚合；demo 构建静态页零改动 |
| A5 | 回归 | 既有 OM 资产零删除（`superset-dataos` 仪表盘链、`ods_ep` 原 3 表）；quality-runner / mpi-service / EP 采集链路零变更；前端 qa 与 mvn 既有测试零修改全绿 |
| A6 | 留证 | OM UI（三库）与门户（库切换）截图归档 |

## 五、边界与回滚

- OM 侧：摄取是按全限定名 upsert，不改不删既有实体；回滚 = 删新增表实体（API soft delete）+ 服务连接换回 `dataos_quality_ro`（口令在 quality-runner 容器 env 有备份源）。
- Doris 侧：新增账号独立，drop user 即回滚；不触任何表结构与既有账号授权。
- 代码侧：BFF/前端均为新增分支逻辑，回滚 = revert 提交；demo 构建链路全程无关。
- `deploy/.env`、compose 文件、quality-runner/mpi-service 容器：零触碰。

## 六、延后清单（本批不做）

- `dataos_quality_audit` 空库纳入（有表后按需）
- dbt 摄取 + 列级血缘（G7 候选主体）
- `deploy/.env` `DORIS_PASSWORD`（root 口令）清理与 Doris root 口令轮换（安全收敛批）
- OM 摄取编排进「外部运行」统一状态机；`doris-medical` 遗留服务 root 连接收敛（G1 遗留不变）
