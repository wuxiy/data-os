# 医数中枢前端技术栈迁移实施计划

> 日期：2026-11-16｜状态：**原型已批准，实施计划待用户审核**。
> 本轮仅编制计划与冻结设计依据，尚未启动 FE0、安装依赖、修改正式应用代码或部署。
> 正式代码基线：`64aa39b`；设计基线：[原型 v0.2](design/continew-review-20261116/REVIEW.md)、[批准制品校验清单](design/continew-review-20261116/APPROVED-BASELINE.json)。

## 1. 推荐方案与完成定义

在现有 `prototype/` 内分批迁移，保持 React 19、TypeScript、Vite SPA、既有 API 与 OIDC；用 shadcn/ui + Tailwind 4 重建表现层，TanStack Router/Query/Table/Form 分别承担导航、服务数据、表格与复杂表单。按 FE0–FE7 八个 Gate 推进，预计 **40–58 人日**。

不另建长期并行门户，不引入 Start/SSR、第二套身份认证、新后端服务、数据库迁移或新的业务 API。实施会涉及 8 个以上文件，覆盖页面、组件、样式、客户端信号透传、测试与前端 CI；不是对四张原型图的局部换肤。

完成须同时满足：

1. 全部 17 个现有入口及其业务能力迁移，原对象深链、技术深链和权限边界可用；10 个新增工作页路由完成对应的原有操作迁移。
2. 全站采用已批准的浅色分组侧栏、48px 顶栏内页签、蓝灰主题、连续表格和按任务选择的操作容器。
3. 正式页面使用真实 API；原型合成数据不进入生产路径，API 不可用不补演示结果。
4. 现有 45 项测试零修改全绿；新增导航、数据生命周期、容器和业务回归通过；双 QA 保留原业务不变量。
5. 生产依赖不再包含 antd，正式入口不再加载旧主题；仍输出 `prototype/dist`，院内浏览器无 CDN、在线字体或运行时组件下载依赖。
6. 交付可复现的新制品、持久回滚包、验收证据与开发环境发布操作单；实际远端发布按第 9 节授权范围执行。

**最小验证切片**为 FE0 + FE1 + FE2（14–20 人日）：先证明工程底座、真实数据和复杂接入流程成立；该切片不作为全站迁移完成，也不默认替换现网。

## 2. 已核对的迁移基线

| 项目 | 当前事实 | 计划约束 |
| --- | --- | --- |
| 工程 | React/DOM 19.2.8、TS 5.7.3、Vite 6.4.3、plugin-react 4.7.0、antd 6.6.6 | 保持 React/Vite/TS 主版本和 npm 工具链，锁精确补丁 |
| 测试 | 10 文件、45 项，已执行测试收集，**本轮未运行其测试或构建** | FE0 重跑形成真实绿基线，不用历史结果代替 |
| 路由 | `src/data/routes.ts` 的 17 个静态 pathname，无现成 `/:id` 工作页 | 保留原入口；新增路由是本轮迁移产出 |
| 数据与身份 | 11 个业务 API client、统一 `http.ts`、`oidc.ts`、`runtimeMode.ts`、`domain.ts` | 保留 DTO、端点、状态语义和责任边界 |
| 覆盖层 | 24 个 antd Drawer + 2 个自绘覆盖层；另有行内确认 | 按已审查的 [26 入口清单](design/continew-review-20261116/OVERLAY-AUDIT.md)逐项迁移 |
| CI | 前端 job 有 npm ci、audit、双 QA、build，**没有 Vitest** | 在同一前端 job 接入现有测试，不扩展 H5 全栈矩阵 |
| 发布 | 静态 dist → Nginx 挂载目录；dev/prod 代理覆盖不同 | 保持产物和 API 命名空间；不把前端迁移扩成生产编排补齐 |

依据：[package-lock](../prototype/package-lock.json)、[App](../prototype/src/App.tsx)、[路由表](../prototype/src/data/routes.ts)、[HTTP](../prototype/src/data/http.ts)、[CI](../.github/workflows/ci.yml)、[生产构建脚本](../deploy/production/scripts/build-portal.sh)。

## 3. 技术决策与依赖冻结

### 3.1 依赖和职责

以下为 2026-11-16 已核对官方版本元数据的冻结目标，**不等于已安装验证**。FE0 安装并冻结全部首版候选依赖（含 Form），通过临时兼容探针、类型检查、现有测试和构建后才进入 FE1；探针留在临时工作区，不另建长期应用。下表 FE1/FE2 表示首次正式业务使用，不是再次决定加入范围。

| 依赖 | 冻结目标 | 职责 / 首次正式使用 |
| --- | --- | --- |
| Node / npm | 22.23.5 / 10.9.9 | FE0 统一项目与 CI 环境；不修改系统全局默认版本 |
| React / ReactDOM | 19.2.8 / 19.2.8 | 沿用 lock，保持同步 |
| TS / Vite / plugin-react | 5.7.3 / 6.4.3 / 4.7.0 | 保持现有构建体系 |
| Vitest / jsdom | 4.1.10 / 29.1.1 | 保留现有测试工具；Node 22 需至少 22.13 |
| tailwindcss / [@tailwindcss/vite](https://registry.npmjs.org/@tailwindcss/vite/4.3.5) | 4.3.5 / 4.3.5 | FE1；插件明确支持 Vite 6 |
| [@base-ui/react](https://registry.npmjs.org/@base-ui/react/1.9.0) | 1.9.0 | FE1；与参考项目同一组件底层 |
| shadcn CLI | 4.23.0 | FE1 生成 base / base-nova 组件源码；不是运行时组件库版本 |
| [@tanstack/react-router](https://registry.npmjs.org/@tanstack/react-router/1.170.46) | 1.170.46 | FE1；代码路由、search 校验、阻止离开、滚动恢复 |
| [@tanstack/react-query](https://registry.npmjs.org/@tanstack/react-query/5.107.1) | 5.107.1 | FE1；服务数据、失效、取消与受控刷新 |
| [@tanstack/react-table](https://registry.npmjs.org/@tanstack/react-table/9.3.1) | 9.3.1 | FE1；按 v9 `useTable/tableFeatures`，不套 v8 `useReactTable` 示例 |
| [@tanstack/react-form](https://registry.npmjs.org/@tanstack/react-form/1.33.5) | 1.33.5 | FE2；复杂联动、数组字段、跨字段验证与提交状态 |
| [playwright](https://registry.npmjs.org/playwright/1.65.1) | 1.65.1 | FE0；可复现的前端浏览器验收，不依赖临时缓存中的 alpha 版本 |
| @types/node | 22.19.3 | FE1；与 Node 22 环境对齐 |
| 样式辅助 | clsx 2.1.1、tailwind-merge 3.7.0、class-variance-authority 0.7.1、tw-animate-css 1.4.0 | FE0 同步冻结，FE1 随组件源码首次使用；Lucide 沿用现有依赖 |

Virtual 首版不安装；当前以真实分页和限高列表交付。只有出现必须一次展示大量行且分页无法满足的明确场景，再以实际渲染对比决定是否加入 `@tanstack/react-virtual` 3.14.26；虚拟化不替代后端分页。搜索框等简单输入不接 Form，不引入额外全局 Store。

FE0 创建 `prototype/.node-version` 固定 22.23.5，记录 `packageManager: npm@10.9.9`，前端 CI 读取该版本文件。全部首版依赖使用精确补丁和 `package-lock.json`，CI 使用 `npm ci`。shadcn CLI 的版本不能冻结远程 registry 内容，因此 FE0 保存所用 registry 内容与来源校验，FE1 基于该快照生成；生成文件、来源、preset 和许可证清单一并入库，CI 不重新拉取生成组件。任何升级单独提交并重新验收。

官方依据：[Node 22.23.5](https://nodejs.org/en/download/archive/v22.23.5)、[Base UI 默认方案](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)、[Query 的 TS 与补丁冻结约定](https://tanstack.com/query/latest/docs/framework/react/typescript)、[Table v9 分页](https://tanstack.com/table/latest/docs/framework/react/guide/pagination)、[Playwright Library](https://playwright.dev/docs/library)。精确版本与 peer/engines 对应上表的 npm 官方版本记录；FE0 记录实际 resolved/integrity 清单。

### 3.2 架构与单一属主

```text
现有 OIDC / AuthSession
  └─ 会话级 QueryBoundary
      └─ TanStack Router + 新 AppShell
          ├─ 页面 / 业务域 queries & mutations
          │   └─ 现有 11 个 API client → http.ts → 现有服务
          ├─ Table：表格交互；可分享条件由 Router 控制
          ├─ Form：输入、校验、dirty、submitting
          └─ shadcn/Base UI：Sheet / Dialog / AlertDialog / Popover
```

- **Router** 使用官方支持的代码路由，使现有 `routePaths` 继续作为路径声明唯一来源；导航、命令面板和新 route tree 共享它。选择代码路由是本项目减少生成器和双份路径知识的取舍，不称为官方首推。采用原生 Link/navigation/blocker，不再维护手写 history 分发器。[官方代码路由](https://tanstack.com/router/latest/docs/routing/code-based-routing)
- **Query** 拥有服务数据；Router loader 只调用同一 QueryClient 预取，不拥有第二份业务缓存。每个资源迁移时同步停用其旧 hook/定时器，避免双请求和双轮询。
- **HTTP/业务语义** 继续由 `data/http.ts`、各 API client、`domain.ts`、`runtimeMode.ts` 持有。仅按需补齐可选 AbortSignal 透传，不改 URL、payload、错误码或后端状态机。
- **测试兼容** 保留 `MpiReviewLive`、`AssistantLive` 的具名导出、Props 和 API mock 落点；独立挂载边界可提供局部 QueryClient，正式路由复用会话 Client，确保旧测试无需加 Provider 或改断言；`askAssistantQuery(text, params)` 两参数形状、中文参数标签和 MPI 搜索带 signal 的客户端调用保持。旧 hooks 及其测试保留为兼容 seam；迁移完成后业务页面零导入旧资源/轮询 hooks，测试文件不为清理代码而删除。新 Query 的取消专项不复制旧轮询“仅首发带 signal”的局限。
- **公共 UI** 只复用基础组件、Table、三类容器和退出守卫，不构造“万能 CRUD/JSON 表单引擎”。业务参数树仍由后端合同和现有领域适配解释。

拟调整目录：`src/app/`（router/providers/session）、`src/components/ui/`（源码组件）、`src/components/table/`、`src/components/overlays/`、`src/features/<业务域>/`（页面及 query options）、`src/styles/`（唯一新主题）。`data/` 的业务客户端路径保留；这些新目录本轮尚未创建。

### 3.3 新旧样式过渡

迁移中保留 antd 以承载尚未迁移的页面，逐 Gate 收敛，最终移除；不发布长期双组件库版本。

- Tailwind 使用官方拆分导入，迁移期不导入 `preflight.css`；新组件显式补齐必要基础样式。
- 新令牌以 `styles/tokens.css` 为唯一来源；旧 `globals.css` 的元素规则与 v3 变量限制在 legacy 根区域，`main.tsx` 不再把旧主题写到整个 document。新壳和旧页面有各自主题根。
- antd 的 Drawer/下拉等 portal 指向 legacy overlay 根；Base UI portal 指向新主题 overlay 根。不能只禁 Preflight 就宣称已隔离，FE1 必测抽屉、表单、表格和浮层的字体/边框/焦点/层级。
- FE7 删除生产路径的旧主题、antd Provider 和旧全局覆盖，统一为一份显式基础样式；继续不引入未验证的全局 reset，避免末阶段突然切换 Preflight。

依据：[Tailwind 禁用 Preflight](https://tailwindcss.com/docs/preflight#disabling-preflight)、[antd 共存说明](https://ant.design/docs/react/compatible-style/#compatible-with-third-party-style-libraries)。

## 4. 必须守住的数据与交互合同

### 4.1 会话、查询与动作

| 约束 | 实施规则与验收 |
| --- | --- |
| 会话隔离 | 当前 AuthSnapshot 没有 tenant/subject 字段。以不含 token 的临时 session epoch 管理 QueryClient 生命周期；登录会话变化、退出、401、到期时取消并清缓存。不得用 displayName 当身份键，不增加虚构机构切换。 |
| 登录回调 | OIDC 先消费 `code/state/error`，Router 再校验业务 search。保留 PKCE/state 和现有到期清理；同源、已知路由的 returnTo 保留原业务目标，回调凭据不进入 URL 状态持久化。当前没有自动 refresh-token，不在迁移中新增。 |
| Query key | 含资源类型、对象键、实际筛选/分页和运行模式；服务事实仅内存缓存，不持久化到 localStorage。自由文本/患者检索/问数参数/密钥不写前端路由、页签存储或日志。 |
| 默认刷新 | 普通读取默认不自动重试、不因窗口聚焦重发；已有数据刷新保留工作区。重试由可见按钮触发。资源自己的超时与业务轮询规则保持。 |
| Mutation | `retry:false`，一次用户意图只调用一次客户端；提交互斥，成功后失效相关资源。不得乐观标成功、批准、合并或送达。提醒/交付客户端每次调用会生成新幂等键，禁止自动重调生成新键。 |
| POST 同步 | 质量“同步结果”是 POST。由质量域的受控调度触发 Mutation，不作为普通 queryFn 被预取、聚焦或重试触发。保留原 nextPollAt、2–60 秒边界、最多 12 次策略。 |
| 其他轮询 | 采集详情保留 5 秒节奏；AI 构建保留 2 秒/最多 150 次及超窗仍为执行中的提示；关闭/切键停止观察，不等于取消后端执行。 |
| 取消与旧结果 | Query signal 透传到 HTTP；详情切键清旧值，旧响应不能覆盖新对象；卸载取消静默，自身超时显示不可用；主体与从属资源分开失败。 |
| 表格 | MPI 搜索保留 300ms 防抖和服务端 q，不能只过滤首 100 条。逐接口登记页码 0/1 起点、真实 total、截断、排序/过滤能力，不伪造后端不支持的排序。 |
| 临时凭证 | API Key 单次回显与 Superset Guest Token 不纳入持久缓存/URL/页面截图；按现有生命周期处理，离开看板清理 iframe。 |
| 真实/演示 | 复用 runtimeMode 和 DemoDataBoundary。工作空间选择、趋势数值和通知样例不是新业务功能；正式壳仅显示现有真实上下文。没有序列接口的趋势显示待接入，不虚构走势；通知预览只链接已有待办，不新增个人已读/未读中心。不硬编码医院或负责人。 |

### 4.2 容器和长任务

执行已批准的 [操作容器规范](design/continew-review-20261116/OVERLAY-GUIDE.md)：5 个 Sheet、9 个 Dialog、2 个 AlertDialog、9 个独立页/Tab、1 个内联试运行区；另将现有 6 类行内二次确认及 MPI 拆分按后果单独确认。

生产实现使用 Base UI 的焦点/模态原语，不直接复制静态原型手写的 DOM 焦点控制器。Form 的 dirty/submitting 与 Router blocker 共用退出判断，覆盖取消、X、Esc、遮罩、路由、关页签和刷新前提醒。继续编辑不丢值；提交失败不关闭；切换详情 Tab 保留未保存说明；只读详情转表单先关闭原层。确认初始焦点在取消。

长任务的新页必须承接正式门户的完整参数、库表选择、SQL、白名单、增量水位、预检和校验，不以原型简化 JSON 表单替换这些能力。质量主从处理、MPI 双身份比对、映射版本比较继续采用宽常驻工作区。

## 5. 路由与业务覆盖清单

### 5.1 保留的 17 个入口

| Gate | 现有入口 | 一并保留的能力 |
| --- | --- | --- |
| FE2 | `/` | 真实运营指标、待办、来源/时间、事件与下钻；不把技术探针当业务完成 |
| FE2 | `/ingestion` | 来源登记/检查/连接、库表浏览、结构化与 SQL 任务、复制、配置 JSON 默认展开、运行、人工对账与周期调度 |
| FE3 | `/governance` | 治理待办、SLA、责任链来源、跨页定位，质量总分/等级/六维与规则得分；无完成运行显示 —，未完成运行不计总分 |
| FE3 | `/governance/standards` | 数据元/值域、版本、草稿/评审/发布/停用、导入预检、对比、影响、术语投影同步状态与 FHIR 导出 |
| FE3 | `/governance/mapping` | 映射集/版本、字段映射、checksum 绑定验证、覆盖率、导入预检、评审、生效/回退、影响与审计 |
| FE3 | `/governance/quality` | 规则动态参数与证据策略、评分权重/等级、问题处理、异步复检、通知队列和批量提醒 |
| FE4 | `/mpi/review` | 全队列搜索、候选证据、同人/不同人决策、黄金人/审计/拆分、操作后队列推进 |
| FE4 | `/assets` | 业务目录、字段结构、质量测试、上下游影响、从属资源独立失败 |
| FE4 | `/assets/technical` | 真实新标签深链、FQN/字段/血缘与分页，不换成提示文案 |
| FE5 | `/analysis` | Guest Token、嵌入选择/重挂载/清理、权限与错误恢复 |
| FE5 | `/ai-data` | 产品/版本、Recipe、构建/轮询、6C/评估、评测/比较、人工认证、发布/撤下/弃用、反馈 |
| FE5 | `/data-services` | 创建、契约、发布/下线、Key 发放/吊销、调用与合同事件/订阅；不新增当前门户没有的定义编辑能力 |
| FE5 | `/assistant` | 已验证问题、动态参数、日期输入即取值、拒答、查询证据、就地错误 |
| FE5 | `/assistant/workspace` | 问题治理创建/编辑、试运行、事件与审计、角色深链限制 |
| FE6 | `/operations-center` | 跨域待办、事件、来源和状态下钻 |
| FE6 | `/delivery-center` | 项目目录、引用对象、目标日/负责人、阻断、启动/快照/验收与键盘选择 |
| FE6 | `/operations` | 技术角色限制、前置机登记/版本/历史、组件状态、受控真实入口和未知态；不暴露内部凭据 |

### 5.2 新增的 10 个工作页模式

这些是既有操作的容器迁移，不新增后端合同；统一登记在 routePaths，新路由有页面级权限和对象存在性检查。

| Gate | 新模式 | 内容 |
| --- | --- | --- |
| FE2 | `/ingestion/new` | 完整任务创建 |
| FE2 | `/ingestion/sources/$sourceId/explorer` | 来源库表、字段与只读查询工作区 |
| FE2 | `/ingestion/jobs/$jobId` | `tab=overview/configuration/scheduling/runs`；调度实例、日志与补数归此任务上下文 |
| FE3 | `/governance/quality/rules/new` | 规则创建 |
| FE3 | `/governance/quality/rules/$ruleId/edit` | 规则编辑、动态参数与证据列 |
| FE3 | `/governance/quality/scoring` | 权重、等级和评分配置 |
| FE5 | `/data-services/new` | SQL 模板、参数/列、限额和超时等完整创建 |
| FE5 | `/assistant/workspace/questions/new` | 已验证问题创建 |
| FE5 | `/assistant/workspace/questions/$questionCode` | `tab=definition/try/events`；DRAFT 可编辑，PUBLISHED 只读定义并允许试运行，不开放已发布内容修改 |
| FE5 | `/assistant/workspace/audit` | 跨问题审计与筛选 |

### 5.3 深链与恢复规则

- 保留 `quality?issue=…`、`mpi/review?task=…`、`ai-data?product=…`、`assets?db=…&asset=…`、`assets/technical?asset=…`；真实资产参数保持 FQN。`scenario` 仍只用于演示场景，不当成真实对象合同。
- 每个新工作页带校验后的同源 returnTo；回列表恢复非敏感筛选、页码与滚动。页签只保存会话内路由状态，未保存编辑页通过 blocker 处理，不做全站 KeepAlive。
- 17 条旧入口不重命名；新增路径由 Nginx SPA 回退直接刷新。未知路径改为明确的“页面不存在 / 返回总览”，不再静默显示首页；HTTP 代理合同不变。
- 最终矩阵为 **17 个既有入口 + 10 个新增模式**。回滚到旧包后新增编辑页不再存在，回滚操作单提供对应父列表入口，不承诺恢复被放弃的本地草稿。

## 6. FE0–FE7 实施与验收

Gate 是工程验收门槛，不要求用户逐 Gate 重复批准。当前计划审核不启动任何 Gate；用户后续明示实施后按授权范围推进，范围扩大或依赖关键假设失败时再提交具体调整。

| Gate | 工作范围与交付 | 依赖 | 人日 | 通过条件 |
| --- | --- | --- | --- | --- |
| FE0 基线与兼容验证 | 冻结批准原型及业务基线；建立路线/能力/分页/轮询清单；锁 Node/npm/全部首版依赖与 registry 快照；记录旧 dist/hash；收集并运行 45 测试；验证新依赖最小兼容面，形成风险结论 | 计划批准并收到实施指令 | 2–3 | 旧基线绿、新依赖安装/类型/最小构建通过；无业务路由/接口漂移，兼容失败不进入 FE1 |
| FE1 公共底座 | Router/会话 QueryBoundary、新主题、新 AppShell/顶栏页签/命令搜索、基础 Table 与三类容器/退出守卫；新旧样式/portal 隔离；前端 CI 补 Vitest | FE0 | 5–7 | 17 旧入口可达；OIDC callback/深链/401/角色与会话缓存隔离通过；旧页面未被 Preflight 污染；45 原测试仍绿 |
| FE2 总览与接入纵切 | 迁移首页和接入全部能力，新增 3 个工作页；Form 首次用于复杂任务；来源/复制 Dialog、运行 Sheet、调度/日志 Tab；替换该域旧数据 hooks | FE1 | 7–10 | 登记→检查→配置→运行观察/失败/UNKNOWN→返回路径通过；完整参数无缩水，同一资源无双轮询 |
| FE3 治理闭环 | 治理驾驶舱、标准/映射、质量/规则/评分、责任链；新增 3 个工作页；删除/批量提醒确认，质量 POST 受控同步 | FE2 | 7–10 | 总分/等级/六维/规则得分及无运行口径、版本/预检/生效/回退、复检登记与最终结果分离、nextPollAt/互斥/通知语义、失败保值和真实来源通过 |
| FE4 资产与 MPI | 目录/技术血缘及 MPI 主从复核；候选搜索、黄金人详情、拆分确认；资产从属资源降级 | FE2；可与 FE3 分工并行 | 4–6 | FQN 深链、新标签/刷新、服务端 q、窗口外候选、决策回读/队列推进、拆分取消无写入；不显示行级医疗样例补位 |
| FE5 数据应用 | AI Data、数据服务、分析、问数与治理；新增 4 个工作页；复杂动态 Form、审批/下线确认、SDK 生命周期 | FE3 + FE4 | 7–10 | AI 构建/评测/人工认证不缩水；Key 单次回显；问数双日期立即提交/拒答、已发布问题只读试运行；嵌入授权与离开清理通过 |
| FE6 运营交付运维 | 运营中心、交付中心、平台运维（含前置机登记/版本/历史，保持技术角色边界）；短登记 Dialog、交付证据与阻断主从、技术权限和入口 | FE3 + FE4；可与 FE5 分工并行 | 4–6 | 80 项合成交付列表键盘/分页/选中详情，启动/快照/验收幂等与回读，权限深链与未知状态通过 |
| FE7 全站收口与发布准备 | 移除生产 antd/旧主题/旧资源 hooks 引用；按路由懒加载；27 模式全验；离线静态包、依赖/许可证/校验清单、持久回滚包、开发环境发布单 | FE5 + FE6 | 4–6 | 全测试/双 QA/build/全站浏览器矩阵通过；真实模式无演示；新旧制品可复现；本地隔离 Nginx/静态目录的旧新包、hash、深链切换演练通过；授权后的 CI/真实开发发布与回滚证据单列 |

**总量 40–58 人日**，包含前端实现、自测、迁移专项和联调准备，不含等待审批、远端权限恢复或新增业务需求。建议 2 名前端 + 0.5 名测试，按公共底座先串行、业务域后并行安排，约 5–7 周；单人约 8–12 周。后端负责人提供合同解释和开发环境支持，不安排新增后端开发。

各 Gate 产出 `docs/validation/gate-frontend-feN-20261116.md`，包含实施 commit、覆盖路由、合同检查、测试结果、截图/日志、限制与回滚点；一个 Gate 的业务迁移与 H 系列工作不混在同一提交。

## 7. 验证要求

### 7.1 每 Gate 必跑

所有命令在 `prototype/` 下运行：

```bash
npm ci
npx tsc -b
npx vitest run
node qa/mock-audit.mjs
node qa/portal-interactions-smoke.mjs
npm run build
```

仓库根运行 `git diff --check`。新增可复现的 `qa/browser-smoke.mjs`（实施时创建）使用项目锁定 Playwright；浏览器制品在联网构建环境准备，不依赖操作者的临时 npm 缓存。浏览器验收先使用可用 Browser 工具；缺失时记录原因并使用项目脚本。

现有 10 个测试文件中的 45 个测试用例及其断言不改不删；保留旧导出和兼容 seam，不通过退休测试换绿。QA 的旧 App switch、CSS 类和文件路径锁可以迁移到新 route tree/组件，但逐项登记“旧断言→新落点→业务不变量”，不能删专业深链、JSON 默认展开、真实/演示、权限、复检互斥和中文口径等锁。

### 7.2 新增的必要验证

| 类别 | 正常路径 | 错误与边界 |
| --- | --- | --- |
| Router/Auth | 17 旧入口、新页刷新/后退/前进、标题/页签、OIDC 后恢复目标 | 无权限深链、未知路径、恶意外部 returnTo、callback 参数误删、401/退出清缓存 |
| Query | 读取、已有数据刷新、动作后失效 | 切键/旧响应、超时/卸载取消、独立次级失败、不自动重试写入或 POST 同步 |
| Table | 检索、分页、选择、列设置、返回位置 | 服务端 total/截断、0/1 页码、MPI 窗口外搜索、筛选清空/删除末页记录 |
| Form/容器 | 输入/数组/联动、预检、保存、取消 | 日期末字段、JSON/SQL 错误、服务端拒绝、dirty 的各退出通道、重复提交、Tab/Esc/焦点 |
| 业务状态 | 运行观察、复检登记、通知入队、人工认证/发布 | UNKNOWN 人工对账、通知未送达、尚未认证、Key 回显、失败后无伪成功 |
| 浏览器 | 页面身份、主工作区、关键动作、真实/显式演示 | 五类数据状态、无空白/框架错误/console 异常/非预期溢出；禁用/空/失败可恢复 |

各阶段覆盖所改路由 × 真实/显式演示 × 1440×900/1280×800。FE7 完成 27 个路由模式矩阵（动态页使用合成/受控测试 ID），补 1920px、reduced-motion 和关键工作流。原型 74 项检查只是设计证据，不能替代正式 React 页面和真实接口验收。CSS 像素对齐以批准的 v0.2 截图和源码校验清单为准；复杂未画原型页面按同一设计与完整能力清单实施。

本轮不新建 Java/Python 全量测试、系统性压测或故障注入矩阵。若实现涉及后端合同/部署编排，先从当前 Gate 移出并提交范围调整。

## 8. 风险、控制与责任

| 风险 | 控制与停止条件 | 责任 |
| --- | --- | --- |
| 新依赖类型/构建不兼容 | FE0 先验证锁定依赖与 TS5.7；失败停在 FE0，给具体版本/代码差异，不默默升级 Vite/TS 主版本 | 前端负责人 |
| 新旧样式/portal 污染 | 独立主题根、禁迁移期 Preflight、显式 portal 容器；FE1 以旧页与新组件共同截图证明 | 前端负责人 + 测试 |
| 原型简化导致功能丢失 | 按第 5 节和26入口清单逐项核销；既有库表/SQL/动态 schema/版本/审计不被样例替代 | 域实现者 + 业务负责人 |
| Query 引入重复副作用/串会话 | session epoch、cancel/clear、mutation retry:false、受控 POST 调度和幂等专项 | 数据交互负责人 |
| 新框架破坏既有测试 | 保留具名接口与兼容边界；45项零修改；无法满足时停 Gate 提交具体差异，不能减测试 | 前端负责人 |
| 远端 API/OIDC 不可达 | 先完成本地真实模式不可用与合成契约验收；环境故障单列，发布保持未执行，不替换认证或伪造业务结果 | 实施/运维负责人 |
| 静态目录切换未生效 | 不依赖 build-portal.sh 的临时 .old；持久保存旧包与hash，校验宿主/容器/HTTP三处bundle，必要时重建portal | 发布执行者 |
| 生产代理范围不齐 | dev/prod 差异保持显式记录；不借 UI 发布补齐 MPI/Superset/Data API 生产编排，不启动 H4/H5 | 项目负责人 |

最脆弱的前提是“现有业务合同足以支持全部容器迁移，且锁定依赖可在现有 TS/Vite 上编译”。FE0 将兼容风险提前，业务 Gate 遇到真实 API 能力缺口保留现有能力和可见不可用状态，提交独立功能变更，不用 mock 或新后端临时补位。

## 9. 制品、发布与回滚

### 9.1 制品和授权边界

- 继续交付 Vite 静态 `prototype/dist`，无需新增常驻运行时。FE7 按相同配置分别生成显式演示审核包、真实 OIDC 包，保存 commit、lock、构建模式、文件 SHA-256 与依赖/许可证清单；院内安装只拷贝经校验静态制品，不运行 npm/shadcn。
- 生产构建继续使用现有 OIDC 三键守卫；`VITE_DATAOS_DEMO_MODE` 必须未设置，不能写成 `false`。dev 免登录审核包与生产登录包不能混用；不读取或输出秘密值。
- 默认授权范围为本地迁移、验证与可发布制品准备。提交推送、开发环境实际替换、生产发布均需用户明示；若后续实施指令已明确包含相应动作，该授权持续生效，不重复请求。
- 现有 CI 的同一前端 job 增加 Vitest；用户授权推送后要求该提交前端 job 与发布所需检查绿色；其他 job 异常须区分变更引入或存量问题，关联本变更的失败必须修复，不静默放行发布。未推送时标记“远端 CI 未执行”，不能用本地通过替代。
- 本计划不包含生产上线、生产代理补齐或 H4/H5。也不新增任何厂商账号/API Key；复用已有获授权 dev 主机、OIDC 公共客户端、测试账号和业务测试对象。远端连通性和权限尚未在本轮验证，发布前由既有受控凭据来源完成只读预检，文档不保存 secret。

### 9.2 开发环境发布操作顺序

FE7 默认在本地隔离 Nginx/静态目录完成旧新包、hash 和深链切换演练，不依赖远端发布授权。收到对应开发环境发布授权后，再按以下固定步骤执行真实部署与回滚，不跳过持久备份：

1. 保存当前 portal-dist、Nginx/Compose 配置、容器 inspect、入口与容器内 bundle hash，放入独立不可变回滚目录。
2. 使用实际环境的 OIDC/API 构建参数出包，完成本地校验与离线文件校验，不把演示制品当真实模式发布。
3. 原子替换静态目录；只读 bind mount 若仍读旧 inode，按项目既有流程 `force-recreate portal`，不重启无关业务组件。
4. 比对宿主文件、容器文件和 HTTP 返回的 index/JS hash；验证静态资源、17 基线入口和新工作页的直接刷新。
5. 用受控测试对象完成登录/角色、采集配置与运行观察、质量登记与异步回写、资产/MPI、AI/服务/问数、交付的一组真实 smoke，并回读持久化结果。不可达和权限不足按环境问题记录，不冒充通过。
6. 用保留的旧静态包完成回滚演练，再恢复新包并验证；最终提交旧/新hash、测试对象、日志与未验证边界。

### 9.3 回滚边界

- 开发阶段在 `codex/portal-stack-migration` 分支按 Gate 形成独立变更；不把已有 `.impeccable/` 等无关文件纳入迁移。每 Gate 保存前一可运行提交与依赖锁。
- UI/API 合同和数据结构不变，静态制品可直接回滚。现有生产构建脚本会删除 `.old`，因此它不能充当持久回滚仓。
- 已提交的采集、复检、通知、MPI 决策、认证或发布记录不会随静态包回滚；只能沿现有业务恢复流程处理。smoke 使用获授权测试对象，保留动作审计。
- 回滚包包含10个新增工作页到17基线父入口的替代入口表；旧包恢复后不承诺新工作页或未保存草稿仍存在。

## 10. 评审请求与状态

请审核：**在原工程渐进迁移、FE0–FE7 顺序与范围、40–58 人日、27路由模式、零修改既有测试、静态部署与上述授权边界**。

原型的视觉和容器原则已获批准；本计划的实施范围、工作量和执行安排仍待审核。仅回复“计划通过”时记录批准；收到明确开始实施的指令后，才进入指定 Gate 或按已授权的完整计划推进。

## 11. 本轮编制验证

已按正式源码核对全部 17 入口、10 新工作页模式、8 Gate 依赖和人日合计；本地引用路径与20份批准制品 hash 校验通过。业务覆盖、依赖架构、验收回滚三个独立审查完成，修正项已复核。

本轮仅收集现有 10 文件/45 用例的测试元数据、读取官方兼容信息和检查计划；没有安装新依赖、运行应用测试/构建或改动正式源码，所有实施 Gate 仍未启动。
