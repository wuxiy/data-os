# FE4 前端技术栈迁移验收：资产与患者主索引

> 日期：2026-11-16｜Gate：FE4｜状态：**通过**（本地；未推送）
> 前置：FE3（`bf42d1a`）

## 1. 结论

- 资产目录、资产技术视图、患者主索引复核全部迁到新栈；三处均为常驻主从/宽对照工作区。
- `src/pages/MpiReviewLive.tsx` 原地重写为 Query + 新组件，**保留具名导出、Props 与原测试的
  API mock 落点**；既有「服务端 q 搜索」回归测试零修改通过。
- 资产域按 `instanceServiceLabel` / `lineageSchemaLabel` 中文口径渲染，业务视图不出现引擎名与实例原始名。
- 既有 45 项测试零修改；本轮新增 4 项，共 **91 项**全绿；浏览器 6 次路由检查 + 3 条业务流通过。

## 2. 迁移落点

| 入口 | 新实现 | 说明 |
| --- | --- | --- |
| `/assets` | `features/assets/asset-catalog-page.tsx` | 左栏库切换/检索/分页；右栏 字段结构 / 质量测试 / 血缘与消费 / 资产证据 四页签；`?db=`+`?asset=` 深链 |
| `/assets/technical` | `features/assets/asset-technical-page.tsx` | FQN 定位 `?asset=`；无参数时资产选择器；字段表 + 上下游与列映射 |
| `/mpi/review` | `src/pages/MpiReviewLive.tsx`（原地重写）+ `features/mpi/mpi-review-page.tsx` | 指标带、队列检索（300ms 防抖 + 服务端 q）、双身份对照、证据、操作影响、合并确认；黄金人 Sheet + 拆分 AlertDialog |

配套：`features/assets/queries.ts`、`app/query-boundary.tsx`（独立挂载时提供局部 QueryClient）。

## 3. 合同检查

| 约束 | 落地方式 | 验证 |
| --- | --- | --- |
| 服务端搜索 | MPI 队列按 `q` 请求 mpi-service，不在首 100 条上客户端过滤 | 原测试 `MpiReviewLive.test.tsx` 零修改通过 |
| 深链 | `?task=`（MPI）、`?asset=`（技术视图）、`?db=`+`?asset=`（目录）由 Router 校验；选中态回写 URL | 浏览器流 + 测试 |
| 从属资源独立失败 | 质量测试/血缘各自失败只降级对应页签；字段结构仍可用 | `asset-catalog-page.test.tsx` |
| 中文口径 | 实例名、库名、节点类型、规则枚举都经映射；未知值回退原样 | QA 锁 + 浏览器流 |
| 危险动作 | 拆分用 AlertDialog（显示源身份与黄金人、不可撤销、初始焦点在取消）；合并需勾选确认 | 组件实现 |
| 决策语义 | 同人并入黄金人可拆分撤销；不同人为终态否决；决策即审计 | 页面文案 |
| 分页 | 目录/队列为真实分页；侧栏用 compact 分页条（区间 + 页码） | 浏览器截图 |
| 真实/演示 | 新页无演示数据；MPI 不可用时显示真实不可用态 | 新锁 + 代码 |

## 4. 测试与验收

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过 |
| `npx vitest run` | **20 文件 / 91 用例**全绿（原 45 + FE1 18 + FE2 15 + FE3 9 + FE4 4） |
| `node qa/mock-audit.mjs` | passed |
| `node qa/portal-interactions-smoke.mjs` | passed |
| `npm run build` | 成功 |
| `node qa/browser-smoke.mjs --serve --flows fe4` | 6 次路由检查 + 3 条业务流（资产页签、技术深链字段/血缘、MPI 队列服务端检索）通过 |

新增测试：`features/assets/asset-catalog-page.test.tsx`（4）——目录/字段/质量来自真实接口、
深链选中、质量降级不影响字段、血缘上下游与列映射。

QA 锁迁移：`AssetCatalogLive` → `features/assets/asset-catalog-page.tsx`（引擎名/实例名/中文口径）；
`MpiReviewLive` 的原始规则枚举锁 → 新实现（并新增规则中文口径锁）；资产/MPI 旧静态页从
DemoDataBoundary 清单移除，改由「迁移页不得引用演示数据」覆盖。

## 5. 限制与回滚

- 资产目录的「关注变化」按钮在旧页即仅提示、无后端合同，本轮未保留该按钮，避免伪功能。
- 技术视图的原始 FQN 是技术域，按 DESIGN.md 允许展示；业务目录侧仍用中文名。
- 浏览器验收使用 mock 控制面合成契约数据；远端 mpi-service / 血缘 BFF 未联通。
- 回滚点：FE4 前为 `bf42d1a`。
