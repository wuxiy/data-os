# FE5 前端技术栈迁移验收：数据应用

> 日期：2026-11-16｜Gate：FE5｜状态：**通过**（本地；未推送）
> 前置：FE4（`be3c256`）

## 1. 结论

- AI Data、数据服务、分析看板、智能问数与问数治理全部迁到新栈；新增 4 个工作页
  （新建数据服务、新建已验证问题、问题详情三 Tab、问数审计）。
- `AssistantLive` 原地重写（保留具名导出、Props 与参数表单契约），既有 2 项回归测试零修改通过。
- Key 明文只回显一次、构建任务 2 秒轮询（最多 150 次）、访客令牌嵌入与离开清理、发布门（试运行晚于编辑）均保留。
- 既有 45 项测试零修改；本轮新增 2 项，共 **93 项**全绿；浏览器 20 次路由检查 + 4 条业务流通过。

## 2. 迁移落点

| 入口 | 新实现 | 说明 |
| --- | --- | --- |
| `/ai-data` | `features/ai-data/ai-data-page.tsx` | 产品目录 + 详情四 Tab（概览/版本与构建/认证审批/评测反馈）；新建产品 Dialog、反馈 Dialog、弃用/撤下 AlertDialog |
| `/data-services` | `features/data-services/data-services-page.tsx` | 服务目录 + 详情五 Tab（Key 与授权/调用/导出/合同事件/订阅）；发布、下线确认、Key 发放与吊销 |
| `/data-services/new` | `service-editor-page.tsx` | 完整创建：SQL 模板、参数/列契约、限额、超时、负责人 |
| `/analysis` | `features/analytics/analytics-page.tsx` | 看板目录 + 只读嵌入 + 访问证据；切换/离开释放嵌入实例 |
| `/assistant` | `features/assistant/assistant-page.tsx` + 重写的 `src/pages/AssistantLive.tsx` | 问题 → 参数 → 结果/拒答 + 证据栏 |
| `/assistant/workspace` | 同上（professional + 治理） | 治理区块进独立页，不再叠抽屉 |
| `/assistant/workspace/questions/new` | `question-editor-page.tsx` | 草稿创建 |
| `/assistant/workspace/questions/$questionCode` | 同上 | `tab=definition|try|events`；DRAFT 可编辑、PUBLISHED 只读并可试运行 |
| `/assistant/workspace/audit` | `audit-page.tsx` | 结局过滤 + 服务端分页 + 同口径 CSV 导出 |

配套：`features/*/queries.ts`、`governance-section.tsx`（治理区块，动作走控制面并留痕）。

## 3. 合同检查

| 约束 | 落地方式 | 验证 |
| --- | --- | --- |
| 问数参数「输入即提交」 | 受控原生日期输入；点击执行时按当前 state 提交 | 既有测试零修改通过 |
| 拒答语义 | `REFUSED_*` 信封显式呈现，附可问清单；不生成任意 SQL | 页面 + 测试 |
| Key 生命周期 | 明文只回显一次；吊销确认；调用/合同事件独立失败 | 页面 |
| 构建任务 | 投递 202 → 2 秒轮询、最多 150 次；超窗仍提示执行中，不冒充失败 | 页面 |
| 认证门 | CERTIFIED 只能经审批；就绪度与认证档位分列 | 页面 + `lifecycle.test.ts` |
| 反馈 Learning Plane | 失败样本入队，吸收/驳回由人工决定；不自动改版 | 页面 |
| 发布门 | 发布须最近一次成功试运行晚于最后编辑（由服务端判定，前端如实显示） | 治理区块 |
| 嵌入安全 | 访客令牌短时有效；切换看板/卸载清空挂载点；引擎品牌不进文案 | 页面 + QA 锁 |
| 真实/演示 | 新页无演示数据；不可用显示真实不可用态 | 新锁 |

## 4. 测试与验收

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过 |
| `npx vitest run` | **21 文件 / 93 用例**全绿（原 45 + FE1 18 + FE2 15 + FE3 9 + FE4 4 + FE5 2） |
| `node qa/mock-audit.mjs` / `portal-interactions-smoke.mjs` | passed（问数/AI/分析锁迁到新落点） |
| `npm run build` | 成功 |
| `node qa/browser-smoke.mjs --serve --flows fe5` | 8 次路由检查 + 4 条业务流（问数参数执行出结果、服务发布变已发布、AI 评测回执、审计结局过滤）通过 |

QA 锁迁移登记：`AssistantPage` → 路由 + `features/assistant/assistant-page.tsx`；`AssistantLive` 取数与
`AssistantGovernance` 六条锁 → `features/assistant/queries.ts` / `governance-section.tsx` / `question-editor-page.tsx` /
`audit-page.tsx`；`Pager` 锁 → `TablePagination`；`AnalyticsLive` / `AIDataDetailPage` 锁 →
`features/analytics/analytics-page.tsx` / `features/ai-data/ai-data-page.tsx`。

## 5. 限制与回滚

- 旧页面文件（AIDataPage、DataServicesPage、AnalyticsLive、AssistantGovernance 等）仍在仓库但不再被引用，FE7 删除。
- 数据服务的「新建」与「编辑既有服务」共用一套字段；本轮只提供创建页（既有服务定义编辑不是当前门户能力，未新增）。
- 浏览器验收使用 mock 控制面的合成契约数据；`analysis` 的嵌入在 mock 下无真实看板 UUID，页面如实显示「嵌入失败」并提供重试。
- 回滚点：FE5 前为 `be3c256`。
