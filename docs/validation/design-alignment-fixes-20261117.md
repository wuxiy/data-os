# 设计对齐审核与修复 · 2026-11-17（原型 v0.2 基线）

> 基准：[批准原型 v0.2](../design/continew-review-20261116/APPROVED-BASELINE.json)（14 张基线截图）
> 方法：令牌/外壳逐值对照源码 + mock 控制面 1440×900 Chrome 实拍逐页比对

## 审核结论（修复前）

对齐度高：令牌 21 项逐值一致；外壳（256/232/68 侧栏、48px 顶栏、visited-tabs、9px 工作面）一致；覆盖层分工按 DESIGN.md §15 落地；责任链 Sheet 五类对象/来源/时间与基线 06 完全一致。三处结构性偏差均有 Gate 记录背书：

| 偏差 | 依据 |
| --- | --- |
| 质量页常驻主从三栏（非基线表格+610px 抽屉） | 迁移计划 §123 + FE3 Gate「持续核查证据与异步结果用主从」 |
| 资产页库切换主从（非基线筛选列+表格） | FE4 Gate；真实 OM 目录无业务域/质量结果列 |
| 总览 7 张真实运营投影指标卡（非基线 4 卡+趋势图） | FE2 Gate；趋势时序 API 不存在，按「不补样例」红线 |
| 任务编辑页完整参数表单（非基线简化 JSON） | 计划 §123「不以原型简化 JSON 表单替换」 |

## 本轮修复（对齐缺口清零）

| 项 | 修复 |
| --- | --- |
| **脏退出守卫只拦页内出口**（原型拦一切导航；侧栏/页签/浏览器返回直接丢输入） | 新增 `app/dirty-leave-guard.tsx`：TanStack Router `useBlocker`（withResolver + beforeunload）拦一切路由离开，保存成功路径 `allowNextLeave()` 一次性放行；接入采集任务编辑器、质量规则编辑器、问数问题编辑器（问数此前完全无守卫）；`visited-tabs.ts` 的过期 blocker 注释订正；新增 4 项路由级测试 |
| 侧栏患者主索引 nav-count 徽标 | AppShell 复用 `operationsSummaryQuery`（键 ['operations','summary']，与总览同缓存），`reviewPending>0` 时显示，读取失败不显示 |
| 采集任务表勾选列 | 接入 DataTable 既有 `selection`（跨页保留），SelectionBar 提供 批量启用/批量暂停/清空选择 |
| 批量启用/暂停合同 | 逐个走既有单任务状态端点（口径同质量页批量提醒：ok/failed 如实回执）；动作前 Confirm（暂停为 destructive），失败项列出前 3 个 |
| 资产「导出目录」按钮 | 当前库、当前过滤口径下的已读取清单导出 CSV（UTF-8 BOM；列：名称/FQN/物理表名/列数/最近更新/来源）；与页面同源，不补业务口径 |
| 数据源 Dialog 标题 | 「新增数据源」→「登记数据源」，与触发按钮词汇一致 |
| placeholder 色值 | `--color-faint` #7c8795 → #737e8d（原型 `::placeholder` 逐值） |
| 采集摘要第 4 卡 | 「配置待补齐」→「最近 24h 失败 N 次」（`latestRunStatus=FAILED` 且 `lastRunAt` 在 24h 窗口内；任务未配置信息仍以行内标签呈现） |

## 明确不做：侧栏「工作区选择器」

原型有工作区下拉（综合医院 · 数据中心）。核查结论：后端仅有 `institution_id` 不透明作用域键（TenantScope），无机构名称注册表；OIDC token 仅映射 `preferred_username/name/email`，无组织 claim。实现该控件只能造样例名称，违反「不可用显示真实空态，不补样例」红线，故裁定不做。多工作区如需落地，应从后端机构注册表 + OIDC 组织 claim 起步（已记 [下一阶段备忘](../deferred-hardening-backlog.md)）。

## 验证

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` / `npx vitest run` | 通过；**97 用例**（93 既有零修改 + 守卫 4 新增） |
| `node qa/mock-audit.mjs` / `portal-interactions-smoke.mjs` | passed |
| `npm run build` | 成功 |
| 浏览器实测（mock + 1440） | 9/9：守卫拦侧栏离开→询问→放弃后到达目标页；徽标显示 6；摘要卡渲染；勾选 2 项→批量暂停 Confirm→回执；Dialog 标题统一；导出触发下载 `asset-catalog-ods_ep-2026-11-17.csv`；无控制台异常 |
| `browser-smoke --flows fe2,fe3,fe4,fe5,fe6` | 58 路由检查 + 全业务流通过（fresh mock；注意 mock 为内存有状态，flows 复跑前需重启 mock，否则 fe5「发布」撞已发布态） |
