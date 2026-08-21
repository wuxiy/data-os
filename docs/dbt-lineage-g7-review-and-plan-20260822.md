# G7 dbt 摄取与列级血缘方案 — 2026-08-22

目标：把质量层资产化进 OpenMetadata（dbt 测试成为 OM TestCase，表详情可见质量
覆盖），并以**登记式血缘（declared lineage）**补上 MPI 匹配链的表级/列级血缘，
BFF 与门户血缘页投影列级映射。G1 延后项「dbt/质量层血缘（D8）」与
「列级血缘投影」一并收口。

> 上游依据：`docs/lineage-g1-g2-review-and-plan-20260820.md` §五（D8）、
> G3 交付（MPI 匹配链）、G6（三库资产已入 OM）。

## 一、现状事实（2026-08-22 实测/读码）

| # | 事实 |
| --- | --- |
| 1 | dbt 工程 `quality/dbt`：3 个 source（quality_acceptance.quality_sample、ep_edge.ep_mz_cfzb_edge、ep_edge.ep_mz_ypcfmx_edge）+ 1 个 view model（`quality_sample.sql`，`select ... from source(quality_sample)`，**未物化**——runner 只跑 `dbt test`，Doris 无此 view 实体）+ 测试 8 个（EP 4 规则 + quality_sample/schema.yml 的唯一/非空/值域等） |
| 2 | quality-runner 容器（`data-os-dev-quality-runner-1`）内工程在 `/opt/dataos/quality/dbt`；`dbt test --target-path <workdir>/target`，workdir 用后清理，**manifest/catalog 无留存**（artifacts 只剩 summary.json） |
| 3 | dbt 账号 `dataos_quality_dbt`：`dataos_quality_acceptance`/`ods_ep` SELECT + audit 库读写——`dbt docs generate`（生成 catalog，只读）可行 |
| 4 | OM 1.5.11 dbt connector（`source/database/dbt`，database 类 source，需 serviceType=Dbt 的服务实体 + `DbtLocalConfig`：`dbtManifestFilePath` 必需、`dbtCatalogFilePath`/`dbtRunResultsFilePath` 可选）：产出 **DataModelLink**（表详情数据模型）与 **TestCase**（dbt 测试转 OM 质量测试，run_results 提供最近结果）+ dbt tags；**不产生 columnsLineage**（connector 源码零引用） |
| 5 | OM 血缘 API 边响应含 `lineageDetails.columnsLineage`（G1 验收已确认可用）；写入走 `POST /lineage`（`AddLineageRequest`，`lineageDetails.columnsLineage[]`：`fromColumns[]`/`toColumn` 为表 fqn 点列名） |
| 6 | MPI 匹配链（G3，列语义可考 `deploy/scripts/init-mpi-doris.sql` + mpi-service 装载 SQL）：`mpi_source_identity`（四段身份键 + 归一名/哈希）→ Blocking → `mpi_candidate_pair`（pair_id 确定性哈希；identity_a/b = 源身份键两侧）→ 规则打分 → `mpi_match_result`（三态 + 逐字段证据） |
| 7 | BFF `getLineage`：一次组合查询取全图，`collectEdgeNodes` 只留节点、**丢弃边详情**（列级映射现不可达）；资产详情无质量测试面 |

## 二、设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| G7-1 | **dbt 摄取走 OM 原生 connector**：manifest/catalog(/可选 run_results) 摄取到新建 Dbt 服务实体（`dbt-quality-runner`），TestCase/DataModel 由 connector 产出 | OM 一等公民（Data Observability 体系、表详情质量 tab），非硬造；G5 的 4 条 EP 规则与 quality 测试成为资产质量面 |
| G7-2 | manifest/catalog 以**摄取时现生成**留存：脚本在 quality-runner 容器跑 `dbt parse`（manifest，不连库）+ `dbt docs generate`（catalog，只读连库）+ 可选 `dbt test`（run_results；`SKIP_TESTS=1` 跳过），产物 docker cp 到宿主再挂载给 ingestion 容器 | 不动 quality-runner 运行链路与镜像（workdir 清理逻辑有审计理由）；产物即时性与可复现兼得；dbt 账号权限已覆盖 |
| G7-3 | **列级血缘不做摄取式、做登记式**：`deploy/config/openmetadata/mpi-declared-lineage.json`（声明清单，进 Git 可评审）+ 登记脚本（幂等 `POST /lineage`）。范围：MPI 链表级 2 边（identity→pair、pair→result）+ 列级映射（identity_a/b/tenant_id ← source_key/tenant_id；result 的 pair/tenant/identity 列 ← pair 同名列）；`lineageDetails.description` 标注「登记式血缘：依据 mpi-service 匹配链（G3）」 | OM dbt connector 不产 columnsLineage（事实 #4）；dbt 唯一 model 未物化、无表间转换语义——不硬造。MPI 链是平台真实数据流，列语义代码可考；声明式血缘是企业常见口径，如实标注来源即可辩护。**不为演示硬造边**（G1 D5 纪律） |
| G7-4 | BFF 列级投影：`getLineageGraph` 响应的 `edges[].lineageDetails.columnsLineage` 归入对应上下游节点（`LineageNode.columnMappings`：`fromColumns[]`/`toColumn` 短列名 + 方向）；不透出 OM 内部 id | 节点与列映射一次查询同源；UI 在血缘节点下展开「列级映射」 |
| G7-5 | BFF 质量测试面：新增 `GET /api/v1/assets/{fqn}/quality-tests`（OM TestCase 按 table entity 查询，投影 名称/列/最近状态/时间；无测试返回空列表）；OM 不可达沿用 503 语义 | 「资产→质量覆盖」在门户闭环（此前质量面只在治理工单）；复用既有降级与鉴权口径 |
| G7-6 | 门户：血缘节点可展开列级映射（有映射的节点显示「列级 ×N」）；资产详情新增「质量测试」段（live 组件内）；demo 构建零改动 | 行为保持型（D7 纪律延伸） |
| G7-7 | dbt DataModel 的门户呈现（表详情 SQL/模型 tab）**本批不做**（OM UI 已可见）；`quality_sample` view model 未物化不登记血缘（如实记录） | 范围收敛：先资产化（TestCase）与列级投影；模型面后续按需 |

## 三、实施步骤

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| E1 | 脚本与声明清单：`deploy/scripts/om-dbt-ingest.sh`（生成产物 + 建/更 Dbt 服务 + 摄取 + TestCase 对账）；`deploy/scripts/om-declared-lineage.sh` + `deploy/config/openmetadata/mpi-declared-lineage.json` | 进 Git 零口令；shell 语法过；声明清单含列映射与依据注释 |
| E2 | 远端执行：dbt 产物生成 → 摄取 → OM 验证（TestCase 数 = dbt 测试数；DataModel 挂载；表详情可见）；声明式血缘登记（幂等重跑边数不变） | API/OM UI 双验证；EP 4 规则在列 |
| E3 | BFF：列级投影（`LineageNode.columnMappings`）+ `quality-tests` API + 契约测试（stub 模拟 columnsLineage 与 TestCase 响应） | mvn 全绿（新增除外零修改） |
| E4 | 前端：`lineageApi` 类型 + 血缘节点列级展开 + 资产详情质量测试段 + vitest | tsc/vitest/qa/build 全绿 |
| E5 | 远端部署 control-plane/portal + 浏览器验证（列级映射、质量测试、MPI 血缘图）+ 截图 | 截图归档；既有页面零回归 |
| E6 | gate 报告 + CONTEXT.md 术语（「质量测试（TestCase）」「登记式血缘」「列级血缘」）+ 提交推送 + 记忆 | 报告落库 |

## 四、验收清单（gate）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| A1 | dbt 产物 | manifest/catalog(/run_results) 生成留证；生成过程零口令泄漏；quality-runner 运行链路零改动 |
| A2 | 质量测试资产化 | OM TestCase 与 dbt 测试一一对应（数量对账，EP 4 规则点名）；DataModel 挂 source 表；run_results 提供时带最近状态 |
| A3 | 声明式血缘 | MPI 链表级 2 边 + 列级映射入 OM（OM UI 血缘图可见列级）；幂等重跑零重复边；声明清单与登记内容一致 |
| A4 | 门户口径 | 血缘节点列级映射可展开；资产详情质量测试段呈现真实 TestCase；demo 构建零改动 |
| A5 | 回归与门槛 | 既有 OM 资产零删除；G6 三库对账仍零差异；control-plane mvn / 前端 tsc+vitest+qa+build 全绿 |
| A6 | 留证 | OM UI（MPI 列级血缘、表质量 tab）与门户截图归档 |

## 五、边界与回滚

- OM 侧：Dbt 服务实体与 TestCase/DataModel/声明边均为新增实体，回滚 = 删 Dbt 服务（级联其产物）+ 删声明边（`PUT /lineage` 反向删除或 soft delete）；既有 `doris-dataos` 资产零触碰。
- quality-runner：只读其容器与 Doris（SELECT/docs generate），运行链路零改动。
- 代码侧：BFF/前端新增面，revert 即回滚。

## 六、延后清单（本批不做）

- dbt DataModel 的门户呈现（表详情 SQL/模型 tab）
- dbt 测试结果的周期同步（现为摄取时一次性 run_results；编排进外部运行状态机时一并）
- `quality_sample` view model 的物化与血缘（无消费方）
- 摄取编排进「外部运行」统一状态机；安全收敛批（口令轮换 + .env 清理）
