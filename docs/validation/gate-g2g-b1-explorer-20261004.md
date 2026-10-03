# Gate · G2G 批次 1 第一刀：数据源深水区（浏览 + 受控 SQL 工作台）

- 日期：2026-10-04
- 依据：[g2g-batch1-collection-deepwater-plan-20261004.md](../g2g-batch1-collection-deepwater-plan-20261004.md) 第一刀设计
- 结果：**通过**（后端 307/307、前端 qa 链全绿、浏览器交互核验通过）

## 交付范围

### 后端（control-plane source 域）

| 端点 | 语义 |
| --- | --- |
| `PUT /api/v1/sources/{id}/connection` | 登记非敏感连接配置（白名单 jdbcUrl/username/credentialRef；任何模式拒绝明文 password/secret/token；credentialRef 保存时预验证可解析） |
| `GET /api/v1/sources/{id}/catalogs` | 库清单（DatabaseMetaData，上限 200） |
| `GET /api/v1/sources/{id}/tables?catalog=x` | 表清单（TABLE/VIEW，含注释，上限 500） |
| `GET /api/v1/sources/{id}/columns?catalog=x&table=y` | 字段清单（名称/类型/可空/注释，上限 1000） |
| `POST /api/v1/sources/{id}/query` | 受控查询：单条 SELECT/WITH（去注释校验 + 分号单语句）、maxRows 默认 200 服务端封顶 1000、无 LIMIT 语句包层 `SELECT * FROM (…) AS _q LIMIT n+1`、`setMaxRows`+`setQueryTimeout(10s)` 双限制、值转字符串防类型泄露（null 保持 null、byte[] 给占位） |

- `SourceConnections`（包内共享件）：validateJdbcUrl（SSRF 防护）+ 凭据解析 + Properties 组装；check/连接登记/浏览/查询四链路共用，check 行为零变化（既有 44 项测试零修改全绿）。
- V22 迁移：`sources.connection_json TEXT NULL`。

### 前端（prototype）

- `controlPlane.ts`：`saveSourceConnection` / `fetchSourceCatalogs` / `fetchSourceTables` / `fetchSourceColumns` / `runSourceQuery` + `SourceApiItem.connection`。
- `SourceExplorer.tsx`：无连接源先见连接登记表单（三字段，明文不落库提示），保存后进入工作区——库→表两级懒加载树（chips）+ 选中表字段清单（SQL 自动预填 `SELECT * FROM 表 LIMIT 100`）+ SQL 工作台（textarea + 执行 + 结果表 + 截断提示）。样式入 Pages.module.css（explorer 前缀），Drawer 体系与 onNotice/onUnavailable 约定不变。
- `DataIngestionPage`：JDBC 源卡片新增「浏览」动作。

## 与设计的偏差（规划空白补全）

规划假定 `GET catalogs` 可直接实现，但 `sources` 表原不持久化任何连接信息（check 的 jdbcUrl 由请求体临时传入）。补全：V22 `connection_json` + `PUT connection` 端点——只存非敏感键（白名单三键），明文凭据任何模式拒绝，与门户「不落库敏感值」承诺一致。

## 测试证据

- `SourceExplorerApiTest`（8 用例）：以测试进程共享 H2（`jdbc:h2:mem:dataos;MODE=PostgreSQL`）为目标源走真实 DatabaseMetaData——连接登记剥离敏感键与落库内容核验、SSRF/明文/jdbcUrl 缺失负向、catalogs/tables/columns 正路径（H2 PG 模式表类型口径 BASE TABLE）、浏览三负向（非 JDBC 协议/未登记连接/源不存在）、查询正路径（列名/null 单元格/42）、包层截断（SYSTEM_RANGE 5→3 行 truncated、显式 LIMIT 不重复包层、maxRows 5000 钳到 1000）、写语句/多语句/注释绕过拒绝、审计拦截器自动覆盖 query 端点。
- 全量：control-plane 307/307 全绿（含既有 44 项零修改）；prototype `tsc -b`+`vitest run` 28/28+`mock-audit`+`portal-interactions-smoke`+`build` 全绿。
- 浏览器核验（mock 控制面 + vite dev + headless）：HIS 源浏览抽屉全链（库树展开→表 chips→字段清单→SQL 预填→执行→3 行结果含 null 展示与截断提示）+ 无连接源连接表单保存后切换浏览态；视觉合格（抽屉顶部树区与底部结果区两屏核验）。

## 发现的边界（已记 backlog）

1. **Oracle 方言 LIMIT 包层不兼容**：`validateJdbcUrl` 允许 Oracle，但 `SELECT * FROM (…) AS _q LIMIT n` 在 Oracle 不合法（FETCH FIRST 语法）；Oracle 源浏览可用、query 需后续方言分支。
2. **`setQueryTimeout(10s)` 仅 H2 实测**：真实 PG/MySQL/Doris/Dameng 驱动的超时行为待 dev 环境真实源验证。
3. mock 核验时发现浏览器 CORS preflight 仅影响本地 mock（生产同源 nginx 无此面），非产品缺陷，记录备考。
