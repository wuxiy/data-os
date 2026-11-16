# FE2 前端技术栈迁移验收：总览与接入纵切

> 日期：2026-11-16｜Gate：FE2｜状态：**通过**（本地；未推送）
> 计划：[前端技术栈迁移实施计划](../frontend-stack-migration-plan-20261116.md)｜前置：FE1（`38e1ea6`）

## 1. 结论

- 总览与数据接入两个业务域迁到新栈；接入域新增 3 个工作页（新建任务、数据源浏览、任务详情四 Tab）。
- 接入域的旧数据 hooks（手写 AbortController 效应、5 秒轮询机、页码钳制）替换为 Query 查询与失效；
  同一资源不再有第二条轮询。
- TanStack Form 首次用于结构化任务（数组字段、跨字段校验、脏状态）；List 用 TanStack Table v9。
- 既有 45 项测试零修改；本轮新增 15 项（总览数据生命周期、调度 CRON、接入词汇），共 **78 项**全绿。
- 浏览器实测 10 次路由检查 + 3 条业务流（短表单登记、调度预览、库表浏览）通过。

## 2. 迁移落点

| 入口 | 旧实现 | 新实现 | 说明 |
| --- | --- | --- | --- |
| `/` | `ManagementDashboardPage` + `ManagementDashboardLive`（antd） | `features/overview/overview-page.tsx` | 7 张真实指标卡 + 组件覆盖条 + 优先处理表 + 最近事件；单项失败不塌页 |
| `/ingestion` | `DataIngestionPage`（1120 行，5 Drawer + 手写轮询） | `features/ingestion/ingestion-page.tsx` | 数据源 / 采集任务 / 运行记录三 Tab；短表单进 Dialog，配置进工作页 |
| `/ingestion/new` | 旧「新建采集任务」抽屉 | `features/ingestion/job-editor-page.tsx` | 独立页：来源/策略 + 结构化意图或 JSON 并排；JSON 默认展开 |
| `/ingestion/jobs/$jobId` | 旧「任务配置」抽屉 + `JobScheduleDrawer` + 运行抽屉 | `job-detail-page.tsx`（概览/配置/调度/运行） | `?tab=` 由 Router 校验；运行保留 5 秒观察节奏 |
| `/ingestion/sources/$sourceId/explorer` | 旧「数据源浏览」抽屉 | `source-explorer-page.tsx` | 库→表懒加载、字段清单、只读 SQL 工作台；连接登记在工作页内 |

配套：`queries.ts`（Query 键与选项）、`labels.ts`（词汇/默认值）、`cron.ts`（调度 CRON 编译与识别）、
`structured-fields.tsx`（TanStack Form）、`schedule-panel.tsx`、`source-dialogs.tsx`。

## 3. 合同检查

| 约束 | 落地方式 | 验证 |
| --- | --- | --- |
| 写入只调用一次 | 所有 mutation `retry:false`；启动运行带一次性 `Idempotency-Key`（`createRequestKey`） | 代码审阅 + 浏览器流 |
| 无重复轮询 | 运行详情是本页唯一 `refetchInterval`（5 秒）；列表不轮询，刷新由按钮触发 | 代码审阅 |
| 切键清旧值 | 选中对象由路由参数驱动；Query 键含 jobId/sourceId，切键即换缓存 | `job-detail`/`explorer` 实现 |
| 分页口径 | 任务/数据源列表：接口返回全量后客户端分页（服务端未提供 page 参数，如实记录）；调度实例：服务端 `page` 1 基、客户端 0 基换算 | 代码 + 测试 |
| 运行观察不终止执行 | 关闭/切 Tab 只停止观察；文案明确 | 页面文案 |
| 人工对账 | `MANUAL_REQUIRED` 时单列「重新查询 / 确认不存在」，不与同步混淆 | 列表 + 详情 |
| 暂停语义 | 暂停只改生命周期，不终止已提交批次；文案与旧页一致 | 页面文案 |
| 引擎品牌 | 消息经 `businessMessage` 去 SeaTunnel；执行器显示为「中心采集执行器 / 平台调度」 | `labels.test.ts` |
| 真实/演示 | 新页无任何演示数据引用；`FakeSource` 模板仅演示构建可选，真实模式保存被拒 | `qa/mock-audit.mjs` 新锁 |
| 凭据 | 连接登记只收 jdbcUrl/username/credentialRef；JSON 提示不落库明文 | 表单 + 提示 |
| 脏数据退出 | 结构化表单与配置页有未保存内容时，返回/取消先确认；短表单 Dialog 原位询问 | 组件实现 + 浏览器流（短表单） |

## 4. 测试与验收

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过 |
| `npx vitest run` | **17 文件 / 78 用例**全绿（原 45 + FE1 18 + FE2 15） |
| `node qa/mock-audit.mjs` | passed（锁已迁到新落点） |
| `node qa/portal-interactions-smoke.mjs` | passed（JSON 默认展开锁迁到新编辑器） |
| `npm run build` | 成功 |
| `node qa/browser-smoke.mjs --serve --flows` | 10 次路由检查 + 3 条业务流通过（mock 控制面） |

新增测试：

| 文件 | 覆盖 |
| --- | --- |
| `features/overview/overview-page.test.tsx`（3） | 指标/待办/事件来自运营投影、按严重度排序、摘要不可用不回退静态、待办单独失败不塌页 |
| `features/ingestion/cron.test.ts`（6） | 四种周期与延迟一次的编译回读、越界钳制、不可精确表达回落高级模式、时间串互转 |
| `features/ingestion/labels.test.ts`（6） | 状态未知回退、无名源兜底、默认源选择、模板随模式切换、JSON 对象校验、引擎名收敛 |

QA 锁迁移：`ManagementDashboard*` → `features/overview`；`DataIngestionPage` 的两条真实模式锁 →
`features/ingestion/job-editor-page.tsx` 与 `labels.ts`；`<details … open>` 锁 → 新编辑器。新增
「迁移页不得引用演示数据」锁覆盖 5 个新页面。

## 5. 浏览器证据

| 页面 | 结论 |
| --- | --- |
| `/` | 运营投影横幅为真实运行模式；7 张指标卡与待办/事件渲染，无横向溢出 |
| `/ingestion` | 三 Tab、搜索/筛选/分页、行内主操作与「更多」Popover 正常；暂停任务主操作变「启用」 |
| `/ingestion/new` | 来源/策略与结构化意图并排，JSON 默认展开 |
| `/ingestion/jobs/$jobId` | 四 Tab 切换；配置 Tab 回填已存结构化意图（库/表/白名单/序列键） |
| `?tab=scheduling` | CRON 回填每天 02:30、预览返回平台调度引擎计算、实例分页 |
| `sources/…/explorer` | 库展开 → 表选择 → 字段清单渲染 |

截图：`/tmp/fe2-shots/`（本地临时目录，不入库）。

## 6. 限制与回滚

- 列表检索为内存过滤：`/v1/sources`、`/v1/jobs` 未提供 `q`/分页参数，本轮不伪造服务端搜索。
- 「运行记录」Tab 汇总各任务**最近一次**运行（与旧页一致）；完整历史在任务详情。
- 旧页面文件仍保留（`DataIngestionPage.tsx` 等）但不再被路由引用，FE7 删除。
- 浏览器验收使用 `qa/mock-control-plane.mjs` 的合成契约数据；远端真实控制面未在本轮联通。
- 回滚点：FE2 前为 `38e1ea6`；FE2 仅改前端路由与页面，静态包可直接回滚。
