# G2G 批次 1 · 采集操作深水区（规划与交接，2026-10-04）

> 背景：nema（一代平台，已转维护态）→ data-os（2.0 主线）的能力复制计划，共七批。依据与裁决见 nema 仓库 `docs/design/nema-vs-dataos-coverage-matrix.md` §G2G。本文档为批次 1 的开工勘察成果与第一刀实施设计，供新会话直接续作。

## 批次目标

以 nema dep-web 的 23 个域目录为需求清单，把「采集操作深水区」在 data-os 重建为 React 19 门户交互 + control-plane API。优先两域：

1. **dataSource**（数据源深水区）——第一刀，本文档主体
2. **dataCollection**（采集任务深水区）——第二刀，见文末范围

## 勘察结论（两端现状）

### data-os 已有（可复用）

- `source` 域 API：`GET /api/v1/sources`（list）、`POST /api/v1/sources`（create）、`POST /{sourceId}/check`（连通测试，已实现）
- **`JdbcSourceCheckAdapter`**：连接方式已成体系——`SourceNetworkPolicy.validateJdbcUrl`（SSRF 防护）+ `CredentialResolver.resolve(ref, tenant, institution)`（凭据引用，生产禁明文）+ `DriverManager`。**库表浏览/查询后端直接复用这套链路**
- 审计：`audit` 域为 `AuditInterceptor`（HTTP 层自动拦截，新端点免手动埋点）
- 前端：`src/data/http.ts`（portalFetch/throwHttpError 统一传输）、`src/data/controlPlane.ts`（fetchSources/getJson 风格 API client）、`DataIngestionPage.tsx`（688 行单页：源列表+任务+模板配置）
- prototype 栈：React 19 + Vite + lucide-react，**无 UI 组件库、无 Monaco/CodeMirror**（自建设计系统 IntegrationPages.module.css；SQL 编辑器第一版用 textarea 起步）

### data-os 缺失（=本批要补）

- **库表浏览**（nema 对应物 `DatabaseWeb.vue`：源→库→表树 + 字段查看）
- **受控 SQL 工作台**（nema 的 webSql：选中/输入 SQL → 动态 columns/rows 结果表）
- 数据源详情/编辑视图（nema `DataSourceDetail`/`DataSourceInfoForm`）

### nema 参考物（素材库，勿搬运代码只借鉴交互语义）

- `products/collection/dep-web/src/views/dataSource/`（6 文件 1151 行）：`DatabaseWeb.vue`（202 行，树+SQL 工作台布局）、`DataSourceList/Detail.vue`、`components/DataSourceAdd/DataSourceInfoForm/TestDataSource.vue`
- 配套组件 `src/components/DatabaseTree/`（树形目录交互）、Monaco 编辑器的表名 snippet 补全（`setDbSchema`）
- 后端 API 语义：`queryTableNameList(dsId, schema)`（表清单）、`dataSourceWebSql(datasourceId, sqlBase64)`（执行返回 `{columns, rows}`）
- 第二刀素材：`views/dataCollection/`（5 文件 1666 行，`DataCollectionSubtask.vue` 1081 行是重头——表/SQL 双形态任务、字段白名单、子任务/日志两级钻取、任务复制）

## 第一刀实施设计（dataSource 深水区）

### 后端（control-plane source 域新增）

1. **连接获取共享化**：把 `JdbcSourceCheckAdapter` 的「validateJdbcUrl + 凭据解析 + Properties 组装」提为包内共享工具（如 `SourceConnections`），check/catalog/query 三处共用，行为零变化。
2. **目录浏览三段懒加载**（防大库一次拖垮）：
   - `GET /api/v1/sources/{id}/catalogs` → 库名列表（上限如 200）
   - `GET /api/v1/sources/{id}/tables?catalog=x` → 表清单（上限如 500，含表注释）
   - `GET /api/v1/sources/{id}/columns?catalog=x&table=y` → 字段清单（名称/类型/可空/注释）
   - 实现：`java.sql.DatabaseMetaData`；非 JDBC 协议返回 400「仅支持 JDBC 数据源」；DEMO/FakeSource 维持显式边界（真实空态，不伪造目录）。
3. **受控查询** `POST /api/v1/sources/{id}/query`，body `{ sql, catalog?, maxRows? }`：
   - 语句校验：去注释后必须 `SELECT`/`WITH` 开头、单语句（分号后无内容）、非空——否则 400
   - 强制限额：`maxRows` 上限默认 200（服务端封顶，如 1000）；无 LIMIT 时包层 `SELECT * FROM (…) AS _q LIMIT n`（MySQL/Doris 方言）；`Statement.setMaxRows` + `setQueryTimeout`（如 10s）双限制
   - 返回 `{ columns: string[], rows: string[][], truncated: boolean }`（值转字符串防类型泄露；null→null）
   - 超时/SQLExection → 4xx 语义化错误（复用 `ErrorMessages.safe` 防驱动报文泄敏）

### 前端（prototype）

4. `src/data/controlPlane.ts` 增 `fetchSourceCatalogs/Tables/Columns` 与 `runSourceQuery`（getJson/postJson 现有风格）。
5. `DataIngestionPage` 数据源卡片加「浏览」动作 → 抽 `SourceExplorer` 组件（模块 css 随页面体系）：左列三层树（源→库→表，懒加载展开）+ 右侧字段表 + 底部 SQL 工作台（textarea + 执行按钮 + 结果表 + truncated 提示）。空态/加载/错误走页面既有 `onNotice/onUnavailable` 约定。

### 验收

- control-plane：新端点契约测试（H2 mem 作目标源覆盖 catalogs/tables/columns/query 正路径；非 SELECT、多语句、超 maxRows、非 JDBC 协议负向；SSRF/明文凭据沿用既有负向口径）
- prototype：`npx tsc -b && npx vitest run && node qa/mock-audit.mjs && node qa/portal-interactions-smoke.mjs && npm run build` 全绿
- 纪律：提交信息英文；功能迭代（G 系列扩展）不与生产化批次混提交；完成后更新 `docs/deferred-hardening-backlog.md`（若发现新边界事项）

## 第二刀预告（dataCollection 深水区，本批后半）

表/SQL 双形态任务 + 字段白名单 + OrderKey + 子任务/日志两级钻取（1081 行交互）+ 任务复制 → 对接 data-os 已有 `job`/`run` 域与 SeaTunnel 执行器，交互设计照搬 nema 信息架构。
