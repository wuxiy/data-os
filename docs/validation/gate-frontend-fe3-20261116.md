# FE3 前端技术栈迁移验收：治理闭环

> 日期：2026-11-16｜Gate：FE3｜状态：**通过**（本地；未推送）
> 前置：FE2（`4fde95d`）

## 1. 结论

- 治理驾驶舱、数据标准、标准映射、质量工作台（含规则与评分）全部迁到新栈；新增 3 个工作页
  （规则新建、规则编辑、评分设置）。
- 质量工作台改为**常驻主从工作区**：队列 + 处理记录 + 证据三栏同屏，责任链用 Sheet 只读核对，
  不再把处置塞进抽屉（OVERLAY-GUIDE：持续核查证据与异步结果用主从）。
- 规则删除、批量提醒改为 AlertDialog（初始焦点在取消、显示对象与保留内容）；调度删除同样如此（FE2 已完成）。
- 既有 45 项测试零修改；本轮新增 9 项，共 **87 项**全绿；浏览器 8 次路由检查 + 3 条治理业务流通过。

## 2. 迁移落点

| 入口 | 新实现 | 容器分工 |
| --- | --- | --- |
| `/governance` | `features/governance/governance-dashboard-page.tsx` | 指标/待办/责任链摘要/风险排行/评分面板同屏 |
| `/governance/standards` | `standards-page.tsx` | 主从：清单 + 版本/数据元/对比/影响/FHIR + 审计栏；导入 dry-run 先行 |
| `/governance/mapping` | `mapping-page.tsx` | 主从：清单 + 版本/映射项/验证证据/回退 + 审计栏；草稿导入 dry-run |
| `/governance/quality` | `quality-page.tsx` | 主从三栏；`?issue=` 由 Router 校验 |
| `/governance/quality/rules/new` | `rule-editor-page.tsx` | 独立工作页（动态参数 + 证据列） |
| `/governance/quality/rules/$ruleId/edit` | 同上 | 独立工作页；编号锁定、参数回填 |
| `/governance/quality/scoring` | `scoring-page.tsx` | 独立配置页；保存处呈现影响摘要 |
| 责任链 | `responsibility-sheet.tsx` | Sheet（470px，五节点 + 来源 + 时间） |

配套：`queries.ts`（治理/规则/评分/标准/映射 Query）、`quality-score-panel.tsx`、
`rule-form.ts`（参数映射与提交前校验的纯逻辑）。

## 3. 合同检查

| 约束 | 落地方式 | 验证 |
| --- | --- | --- |
| 复检语义 | 「已登记/已投递」≠ 通过；RECHECKING 显式提示等待异步回写 | 页面文案 + 浏览器流 |
| 自动轮询 | `nextPollAt` 到点同步，2–60 秒边界、同一运行最多 12 次；切问题/终态停止 | 代码审阅 |
| 通知 | 提醒入发件箱，不冒充已送达；批量提醒逐条投递、失败不阻断其余并如实汇总 | 浏览器流 + 代码 |
| 人工对账 | MANUAL_REQUIRED 单列重新查询 / 确认不存在 | 证据栏 |
| 评分口径 | 无终态运行的规则不计入均值；无带评分规则收一行空态 | 测试 + 锁 |
| 标准版本 | 发布版本只读；变更走新草稿；术语投影待同步可重试；FHIR 不含内部标识 | 页面 + 锁 |
| 映射版本 | 生效需同 checksum PASS 证据（由服务端门控，前端只显示状态） | 页面 + 提示 |
| 覆盖口径 | 覆盖率与 AI 就绪评估同源（同一投影），不可用时只降级该卡 | 页面 |
| 品牌 | 标准事件 detail 的引擎缩写渲染时改写；映射转换用中文口径 | 锁 + 代码 |
| 真实/演示 | 新页无演示数据；静态样例只在旧页兼容 seam | `qa/mock-audit.mjs` 新锁 |

## 4. 测试与验收

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过 |
| `npx vitest run` | **19 文件 / 87 用例**全绿（原 45 + FE1 18 + FE2 15 + FE3 9） |
| `node qa/mock-audit.mjs` | passed（治理锁迁到新落点） |
| `node qa/portal-interactions-smoke.mjs` | passed（质量/版本控件锁迁移） |
| `npm run build` | 成功 |
| `node qa/browser-smoke.mjs --serve --flows fe3` | 8 次路由检查 + 3 条业务流（问题深链与处理说明回填、规则编辑回填、标准版本切换）通过 |

新增测试：

| 文件 | 覆盖 |
| --- | --- |
| `features/governance/rule-form.test.ts`（5） | 值域/范围/长度/时效参数映射、跨表关联键成对、编辑往返、提交前校验 |
| `features/governance/governance-dashboard-page.test.tsx`（4） | 待办 SLA 排序与已闭环排除、责任链摘要取首位、不可用不回退、评分空态 |

QA 锁迁移登记（旧 → 新）：`GovernanceDashboardPage` → `features/governance/governance-dashboard-page.tsx`；
`GovernanceTabs` 六项治理导航 → `app/navigation.ts`；`QualityIssuesPage` → `quality-page.tsx`；
`QualityScorePanel` → `quality-score-panel.tsx`；`DataStandardsLive` / `StandardMappingLive` →
`standards-page.tsx` / `mapping-page.tsx`；`Pages.module.css` 的 `.versionChip` 高度锁 → 新页
`min-h-[36px]` 断言。全部保留原业务不变量。

## 5. 限制与回滚

- 标准/映射的版本对比、导入与影响范围保留原能力；映射「字段映射」以只读表 + 整体替换/导入维护（与旧页一致）。
- 质量规则表单对 15 类规则的动态参数完整承接；`STAT_VAL_COMPARE` 等派生失败列类型不显示证据列编辑。
- 旧页面文件（GovernanceDashboardPage 等）仍在仓库但不再被路由引用，FE7 删除。
- 浏览器验收使用 mock 控制面的合成契约数据，远端真实控制面未连通。
- 回滚点：FE3 前为 `4fde95d`。
