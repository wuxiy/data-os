# FE6 前端技术栈迁移验收：运营、交付与运维

> 日期：2026-11-16｜Gate：FE6｜状态：**通过**（本地；未推送）
> 前置：FE5（`f7b92ad`）

## 1. 结论

- 运营中心、交付中心、平台运维迁到新栈；**17 个既有入口此时全部由 feature 页面承接**，
  路由树不再引用 legacy 渲染器（旧页面文件仍保留到 FE7 删除）。
- 交付提交的逐项阻断、快照幂等、验收钉住快照、证据包下载、归档确认均保留；
  前置机登记为短表单 Dialog、版本历史为 Sheet（登记新版本内联）、采集水位只读。
- 平台运维保持技术角色边界：403/无权限与网络失败分开提示，不暴露内部凭据。
- 既有 45 项测试零修改；共 **93 项**全绿；浏览器 6 次路由检查 + 3 条业务流（交付阻断、前置机登记、运营待办）通过。

## 2. 迁移落点

| 入口 | 新实现 | 说明 |
| --- | --- | --- |
| `/operations-center` | `features/operations/operations-center-page.tsx` | 跨域待办（类型筛选、严重度排序、分页）+ 事件流；待办深链进对应工作台 |
| `/delivery-center` | `features/operations/delivery-center-page.tsx` | 项目目录 + 交付对象/证据快照/交付事件 + 创建项目 Dialog + 引用对象 Dialog + 提交/验收/归档/证据包 |
| `/operations` | `features/operations/platform-operations-page.tsx` | 核心链路组件、前置机登记/探活/版本历史/删除、采集水位；技术权限不足显示明确空态 |

配套：`features/operations/queries.ts`（运营/交付/平台/边缘 Query；平台 30 秒刷新保留）。

## 3. 合同检查

| 约束 | 落地方式 | 验证 |
| --- | --- | --- |
| 交付阻断 | 409 + blockers 逐项展示（类型/引用/原因），不吞掉 | 浏览器流 |
| 快照幂等 | 同一内容重复生成返回既有快照；界面提示「幂等」 | mock + 页面 |
| 验收钉住 | 验收后记录 acceptedSnapshotId 并要求快照已存在 | 页面 |
| 证据包 | 经 `portalFetch`（带认证）下载，不含行级数据与凭据 | 页面 + 文案 |
| 动作幂等键 | 提交/验收/归档/快照由 API client 生成一次性 Idempotency-Key | API 层未改 |
| 技术角色边界 | 403 与网络失败分开；无权限显示「无技术域访问权限」 | 页面 |
| 前置机凭据 | 只存地址/分组/版本与转发前缀；不存口令 | 表单 + 提示 |
| 刷新节奏 | 平台组件 30 秒自动刷新，其余按钮触发 | queries.ts |
| 真实/演示 | 新页无演示数据；交付 mock 页签随旧页退役 | 路由锁 |

## 4. 测试与验收

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过 |
| `npx vitest run` | **21 文件 / 93 用例**全绿（本轮未新增用例；三页以浏览器流覆盖） |
| `node qa/mock-audit.mjs` | passed，输出改为「17 routes on feature pages」 |
| `node qa/portal-interactions-smoke.mjs` | passed |
| `npm run build` | 成功 |
| `node qa/browser-smoke.mjs --serve --flows fe6` | 6 次路由检查 + 3 条业务流通过 |

QA 锁迁移：运营中心 `fetchWorkItems` → `features/operations/queries.ts`；交付中心四条锁 →
`delivery-center-page.tsx` 与 `queries.ts`；原「静态页必须声明 DemoDataBoundary」清单在 17 入口全部迁移后
退役，替换为更强锁「每条既有路径都由 createRoute 注册，且路由不得回退 legacy」。

## 5. 限制与回滚

- 交付中心的键盘选择（旧页方向键切换项目）未保留为独立键盘协议：列表项是原生按钮，
  Tab/Enter 可用；方向键快捷切换不属既有合同，未新增。
- 平台运维的组件图标与「技术探针」文案随新主题简化，状态语义不变。
- 回滚点：FE6 前为 `f7b92ad`。
