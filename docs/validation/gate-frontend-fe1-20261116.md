# FE1 前端技术栈迁移验收：公共底座

> 日期：2026-11-16｜Gate：FE1｜状态：**通过**（本地；未推送）
> 计划：[前端技术栈迁移实施计划](../frontend-stack-migration-plan-20261116.md)｜前置：FE0（`71d7ed3`）

## 1. 结论

- 新壳、新主题、代码路由、会话级 QueryClient、列表原语与三类容器落地；**17 个既有入口全部通过新路由可达**。
- 旧 antd 页面整体挂载在 legacy 主题根内，v3 样式未被 Tailwind 污染；新主题不再写到整个 document。
- 既有 45 项测试**零修改全绿**；新增 18 项测试覆盖路由登记、会话隔离、容器守卫与列表原语。
- 浏览器实测 34 次（17 路由 × 1440/1280）+ 壳交互 5 项通过，无应用控制台异常、无横向溢出。
- 未推送，远端 CI 未执行；FE2 起逐域替换旧页面。

## 2. 交付物

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 主题 | `src/styles/tokens.css` | 唯一新主题：批准原型 v0.2 的蓝灰令牌、语义字号（13px 基准）、圆角/阴影/侧栏宽度；Tailwind 4 拆分导入且**不导 preflight** |
| 主题隔离 | `src/styles/legacy.css` | v3 令牌与元素规则收进 `#legacy-root`；antd portal 目标 `#legacy-overlay` |
| 路由 | `src/app/router.tsx` | TanStack Router 代码路由；17 入口 + search 校验 + 壳内「页面不存在」/错误恢复 |
| 路由登记 | `src/data/routes.ts` | 17 个既有 pathname 不变；新增 10 个工作页模板与 builder；既有深链 builder |
| 导航 | `src/app/navigation.ts` | 分组侧栏、治理六子项、页签/标题解析、父入口高亮 |
| 会话 | `src/app/providers.tsx`、`auth-gate.tsx` | 会话代际驱动 QueryClient 重建；401/退出/失败进 error；未认证阻断全部路由 |
| 壳 | `src/app/shell/*` | 分组侧栏（256/232/68）、48px 顶栏页签、命令面板（⌘K）、待办/账号 Popover、运行状态横幅 |
| 原语 | `src/components/ui/*` | Button/Input/Select/Field/Badge/Status/Panel/InlineNotice/Popover/Tabs/Segmented/Sheet/Dialog/Confirm/Empty/Skeleton/Toast |
| 列表 | `src/components/table/data-table.tsx` | TanStack Table v9（分页/选择/列可见性/列宽）+ 工具栏 + 分页条（0 基页码、真实 total） |
| 浏览器验收 | `qa/browser-smoke.mjs` | 项目锁定 Playwright；17 路由 × 两宽度 + 壳交互 |
| CI | `.github/workflows/ci.yml` | 前端 job 补 `npx vitest run`；Node 版本读 `.node-version` |
| 兼容边界 | `src/app/legacy/legacy-page.tsx` | 旧页面注入点（提示/导航/不可用 + 责任链抽屉），FE2 起逐域缩小 |

## 3. 合同检查

| 约束 | 落地方式 | 验证 |
| --- | --- | --- |
| 会话隔离 | `sessionEpoch` 递增 → 新 QueryClient；不使用 displayName 当身份键 | `src/app/providers.test.tsx` 401 事件推进代际 |
| 登录回调 | OIDC 先消费 `code/state/error`（`initializeOidc` 在 Router 之前），再进入路由 | 浏览器烟测通过；OIDC 实链路未在本轮连远端 |
| Query 默认 | `retry:false`、`refetchOnWindowFocus:false`、`staleTime:15s`；mutation 不重试 | 代码审阅 + providers 测试 |
| 深链 | `quality?issue`、`mpi/review?task`、`ai-data?product`、`assets?db/asset`、`assets/technical?asset` 由 validateSearch 声明，旧页面仍读实际 URL | 浏览器 17 路由可达；脚本锁 |
| 未知路径 | `notFoundMode:'root'` + 壳内空态「页面不存在 / 返回总览」 | 浏览器交互：`/definitely-missing` |
| 页签 | 会话内 sessionStorage，仅存路径；关闭当前页签回退上一页签 | 浏览器交互：打开两页签→关闭回退 |
| 运行模式 | 横幅保留「演示/真实运行模式」「组件就绪」「首期真实范围」口径 | `qa/mock-audit.mjs` 原锁全过 |
| 真实/演示 | 新壳不新增任何演示/合成数据；空态不补位 | 代码审阅 |

## 4. 测试与验收

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过 |
| `npx vitest run` | **14 文件 / 63 用例**（原 45 + 新 18）全绿 |
| `node qa/mock-audit.mjs` | passed |
| `node qa/portal-interactions-smoke.mjs` | passed |
| `npm run build` | 成功（`index-*.js` 1.76 MB / gzip 550 kB；css 204 kB / gzip 36 kB） |
| `node qa/browser-smoke.mjs --serve --shots /tmp/fe1-shots` | 34 次路由检查 + 5 项壳交互通过 |

新增测试：

| 文件 | 覆盖 |
| --- | --- |
| `src/app/navigation.test.ts`（5） | 17 入口 pathname 不变、10 工作页模板登记、工作页不进侧栏、父入口高亮、治理六子项无重复 |
| `src/app/providers.test.tsx`（2） | 401 推进会话代际、OIDC 错误进 error 不冒充已认证 |
| `src/components/ui/overlay.test.tsx`（6） | Sheet/Dialog 脏数据原位询问、继续编辑保值、无脏直接关闭、Confirm 初始焦点在取消、执行中禁止确认与取消 |
| `src/components/table/data-table.test.tsx`（5） | 行渲染、勾选集合增删、空态、隐藏列、分页条真实 total 与 0 基页码 |

## 5. QA 锁迁移登记（旧断言 → 新落点 → 业务不变量）

| 旧锁 | 新落点 | 业务不变量 |
| --- | --- | --- |
| `App.tsx` 的 `case 'assetTechnical':` / `case 'assistantWorkspace':` | `src/app/router.tsx` 的 `assetTechnicalRoute` / `assistantWorkspaceRoute` | 技术视图与专业工作区必须挂载且可深链 |
| `AppShell.tsx` 的 `['assets','assetTechnical']` / `['assistant','assistantWorkspace']` | `src/app/navigation.ts` 的 `activeNavKey` | 子页面打开时父入口保持高亮 |
| `AppShell.tsx` 的交付中心导航项 | `src/app/navigation.ts` 的 `portalRoutes` | 交付中心是一级入口且挂真实路由 |
| `App.tsx` 的 `OidcLoginGate` | `src/app/auth-gate.tsx` | 生产门户未登录时阻断业务页面 |

## 6. 限制与回滚

- 旧页面在壳内仍是 v3 视觉（24px 圆角/Avenir/浅灰画布），与新壳并存；FE2–FE6 逐域替换，FE7 收口。
- 旧页面内部仍渲染 `GovernanceTabs` 一排治理导航，与新侧栏治理子项重复；FE3 迁移治理页时移除。
- legacy 页面仍用 `history.replaceState` 维护自身 search，Router 不接管；新页面改用 Router search。
- 浏览器二进制使用系统 Chrome（`channel: chrome`）；离线环境需预装 Chrome 或 `npx playwright install chromium`。
- 未验证远端 OIDC/API 实链路，`/api/*` 404 作为环境事实单列在烟测记录中。
- 回滚点：FE1 前的 `71d7ed3`（FE0）；FE1 为纯前端结构变更，静态包可直接回滚。
