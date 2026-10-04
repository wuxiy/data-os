# G2G 批次 1 · 采集操作深水区（规划与交接，2026-10-04）

> 背景：nema（一代平台，已转维护态）→ data-os（2.0 主线）的能力复制计划，共七批。依据与裁决见 nema 仓库 `docs/design/nema-vs-dataos-coverage-matrix.md` §G2G。本文档为批次 1 的开工勘察成果与第一刀实施设计，供新会话直接续作。
>
> **进度（2026-10-04）**：第一刀已交付并过 gate——连接登记补全（V22 `connection_json`，规划空白：原 `sources` 表不持久化连接信息）+ 目录浏览三端点 + 受控查询 + 门户 SourceExplorer。契约与浏览器核验证据见 [docs/validation/gate-g2g-b1-explorer-20261004.md](validation/gate-g2g-b1-explorer-20261004.md)；三项边界（Oracle 方言包层/真实驱动超时/驱动报文泄敏面）已记备忘账。**第二刀同日交付并过 gate**——V23 structured_json + StructuredTaskCompiler + 复制/水位端点 + 门户 JobStructuredForm，见 [docs/validation/gate-g2g-b1-structured-task-20261004.md](validation/gate-g2g-b1-structured-task-20261004.md)；三项边界（整数序列键增量/批量建事务包边/SQL 水位占位符自管）已记备忘账。**批次 1 两刀收官。**

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

## 第二刀实施设计（dataCollection 深水区，2026-10-04 定稿）

### 映射裁决（nema → data-os）

- **层级坍缩**：nema「采集任务 → 子任务」两级坍缩为 data-os 单级 job——一 job = 一表或一 SQL；「表任务(批量)」保留为表单内**多选表一次创建 N 个 job**（前端循环，后端不加批量端点）。
- **OrderKey/序列键**：时间类型序列键编译为 `WHERE key >= '${last_success_time}' AND key < '${run_start_time}'` 水位占位符——直接复用既有 checkpoint 机制（`IngestionCheckpointRepository` 已在运行领取/成功推进两端工作）；整数序列键只作 `partition_column`（SeaTunnel 并行分片），增量方式对整数键拒绝并提示改全量+幂等唯一键模型（外部执行器无整型位点回放能力，如实声明边界）。
- **字段白名单**：编译进 SELECT 列清单，保存前经 DatabaseMetaData 实校验列存在。
- **子任务/日志两级钻取** → 既有运行详情抽屉（run 时间线）+ 新暴露「上次成功水位」（checkpoint 读端口）。
- **任务复制** → `POST /api/v1/jobs/{id}/copy`：结构化任务按目标源重编译（表/列在目标源实校验），JSON 任务原样复制。

### 后端（control-plane job 域）

1. V23 迁移：`ingestion_job_configs.structured_json TEXT NULL`——结构化意图（表单形态）与编译产物 config_json 同存，可再编辑/复制；JSON 直接覆盖时清空结构化意图（显式弃结构化）。
2. `SaveJobConfigRequest`/`IngestionJobConfig` 增可选 `structured` 字段（附兼容构造器，既有调用点零修改）。
3. `StructuredTaskCompiler`：spec{form=TABLE/SQL, sourceId, catalog, tables[], columns[], orderKey, mode=FULL/INCREMENTAL, customSql, targetDatabase, targetTable, sinkFenodes, sinkCredentialRef} → 编译 env + source(Jdbc, url/credentialRef 取自源登记连接，driver 按 URL 推断) + sink(Doris, label-prefix 按 jobId 派生稳定)。templateKey=`STRUCTURED_JDBC_TO_DORIS`（不在临床模板目录，走透传校验 + 密钥守卫）。表单校验：源必须 JDBC 且已登记连接；表/列/序列键经目录元数据实校验；SQL 形态走第一刀的只读语句校验。
4. `JobConfigService.save`：structured 存在 → 服务端编译（门户只提交意图，编译单一属主）。
5. `GET /jobs/{id}/config` 响应增 `structured` 与 `lastSuccessWatermark`。
6. `POST /api/v1/jobs/{jobId}/copy`（body `{sourceId?, name?}`）。

### 前端（prototype）

7. `controlPlane.ts`：结构化 spec 类型与 save/copy client 扩展。
8. `JobStructuredForm.tsx`：双形态表单（表多选/SQL+测试）+ 白名单列选择（复用第一刀 columns 端点）+ 序列键选择（时间类型过滤）+ 目标库表/fenodes/sink 凭据引用。
9. `DataIngestionPage`：新建任务抽屉加「结构化表任务 / 结构化 SQL 任务 / 模板 JSON」模式切换；配置抽屉对结构化任务显示结构化编辑器 + 水位；任务行加「复制」动作。

### 验收

- control-plane 契约测试：编译正路径（表全量/增量/白名单子集/SQL 形态）、负向（非 JDBC 源/未登记连接/列不存在/整型序列键增量/SQL 写语句/缺 sink 字段/明文凭据守卫沿用）、copy 重编译、水位暴露、既有 307 测试零修改。
- prototype：tsc + vitest + mock-audit + portal-interactions-smoke + build 全绿；浏览器核验双形态表单→编译产物→复制链。

## 第二刀预告（原文，2026-10-04 上午勘察时）

表/SQL 双形态任务 + 字段白名单 + OrderKey + 子任务/日志两级钻取（1081 行交互）+ 任务复制 → 对接 data-os 已有 `job`/`run` 域与 SeaTunnel 执行器，交互设计照搬 nema 信息架构。
