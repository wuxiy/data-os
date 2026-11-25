# 医数中枢第一版前端原型

面向医院信息中心、数据治理与业务管理人员的桌面端可点击原型。当前覆盖数据接入、管理/治理驾驶舱、标准与质量、主索引、数据资产、分析看板、AI Data、数据服务、智能问数和平台运维等桌面路由页面（`src/data/routes.ts` 登记 17 个既有入口与 10 个操作工作页路由模板，含资产技术视图与问数工作区两条深链；`qa/routes.mjs` 冒烟清单共 29 条 URL）。

## 运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
npm run preview
```

## UI 组件层

界面组件来自 [coss ui](https://github.com/cosscom/ui)（Base UI + Tailwind 4，shadcn 式源码分发），2026-11-24 起全面替换了此前的手写组件层：

- `src/components/ui/`：coss 源码，**原样存放、不修改**。来源冻结在 `coss-registry-snapshot/`（manifest 含 sha256），`node scripts/freeze-coss-snapshot.mjs --verify` 可校验已安装源码与快照一致。升级用 `npx shadcn@latest add @coss/<name>`（`components.json` 已配好 `@coss` 命名空间与 `@/` 别名）。
- `src/components/app/`：只保留没有 coss 对应物的少数几个（EmptyState、Breadcrumb、SearchField、DatePicker、ConfirmDialog、SelectionListItem 等薄组合，以及 FormGrid、ScopeNote、useNotice、useDiscardGuard、Metric）。
- `src/styles/tokens.css`：仍是唯一主题来源。品牌色板与离线字体经文件末尾的令牌桥映射到 coss 语义令牌；项目不导入 Tailwind preflight，base 层补齐了 coss 实际依赖的子集。
- 新增依赖：`@daypicker/react`（coss Calendar）、`@tanstack/react-store`（由传递依赖转为直接依赖）。

约定、coss 的已知契约与升级步骤见 [`docs/agents/frontend.md`](../docs/agents/frontend.md)，组件基线见 [DESIGN.md §18](../DESIGN.md)，改造记录见 [`docs/validation/portal-coss-ui-20261123.md`](../docs/validation/portal-coss-ui-20261123.md)。

## 核心路由

- `/`：医院数据运营总览
- `/ingestion`：数据源登记、采集任务和运行记录
- `/governance`：治理驾驶舱与责任链
- `/governance/standards`：数据标准
- `/governance/mapping`：标准映射
- `/governance/quality`：质量问题闭环
- `/mpi/review`：主索引候选审核
- `/assets`：数据资产、血缘影响和质量结果
- `/assets/technical?asset=asset-outpatient-visit`：数据资产技术视图深链（新标签页打开）
- `/operations`：技术人员专属的平台运维舱，聚合 SeaTunnel 运行态并提供 DolphinScheduler/RustFS 技术入口
- `/analysis`：嵌入式分析看板与指标证据
- `/ai-data`：AI Data 产品工作台（清单、版本与生命周期；仅真实模式接控制面）
- `/data-services`：数据服务工作台（ToB 数据 API 的定义、Key 与调用审计；仅真实模式接控制面）
- `/assistant`：受控智能问数与查询证据
- `/assistant/workspace?scenario=assistant-outpatient`：智能问数专业工作区深链（新标签页打开）
- `/operations-center`：运营中心——面向治理负责人的跨域待办与事件流（与管理驾驶舱共用运营投影事实源）
- `/delivery-center`：交付中心——交付项目、交付项、阻断项、证据快照与验收/证据包下载的全生命周期闭环

### 操作工作页（FE2–FE5）

既有操作的容器迁移（不新增后端合同），路径模板登记在 `src/data/routes.ts` 的 `workPaths`：

- `/ingestion/new`：新建结构化采集任务
- `/ingestion/sources/$sourceId/explorer`：数据源结构浏览
- `/ingestion/jobs/$jobId`：采集任务详情（`?tab=` 切 overview / configuration / scheduling / runs 四页签）
- `/governance/quality/rules/new`、`/governance/quality/rules/$ruleId/edit`：质量规则新建与编辑
- `/governance/quality/scoring`：质量评分模型
- `/data-services/new`：新建数据服务
- `/assistant/workspace/questions/new`、`/assistant/workspace/questions/$questionCode`：问数问题新建与详情（`?tab=` 切 definition / try / events 三页签）
- `/assistant/workspace/audit`：问数治理审计

部署到静态服务器时，需要将以上前端路由统一回退至 `index.html`。

## 责任链来源

责任链通过 `issueId → assetId → ruleId → ownerId → ticketId` 关联生成：异常来自质量规则运行结果，数据对象来自资产目录与采集元数据，治理规则来自规则中心，责任部门来自资产责任人与组织主数据，处理结果来自治理工单。

治理驾驶舱已通过 `src/data/controlPlane.ts` 接入控制面；数据接入页同样读取数据源与采集任务 API；质量闭环页读取治理问题列表、责任链详情、处理说明、复检执行批次、样本证据、自动流转事件和责任人通知状态，并可从详情发起责任人提醒、同步复检结果。数据接入、治理驾驶舱和质量闭环在控制面不可用时不展示演示业务数据，而是显示真实不可用空态。数据标准、标准映射、主索引、资产、分析看板和智能问数也已接入各自后端（控制面标准/映射/问数域、mpi-service 与资产/分析 BFF）；静态演示数据文件已随 FE7 退役，`VITE_DATAOS_DEMO_MODE` 只切换运行状态横幅的「演示运行模式」标记。接入后端时，建议保持页面组件的展示模型不变，将 mock 数据替换为按页面聚合的 BFF/API 响应，避免前端直接拼接五类治理来源。

## 三类开源能力接入边界

- 分析看板：业务门户保留目录、范围和证据栏，中部受控视图由 BFF 签发短期嵌入凭证后加载 Superset；专业人员才进入原生编辑器。
- 数据资产：BFF 聚合 OpenMetadata 的资产搜索、实体详情、血缘、质量结果与责任人，不在业务门户复刻其管理后台；技术视图保留统一登录深链。
- 智能问数：data-os 承担会话、只读边界、证据和反馈，DB-GPT 仅作为可替换编排/执行能力；回答、SQL、来源资产和查询编号通过流式 API 返回。

三个页面均经 BFF 接入对应服务；展示模型由各域 API 模块（`src/data/analyticsApi.ts`、`lineageApi.ts`、`assistantApi.ts`）定义，静态演示数据文件已随 FE7 退役。后续替换 BFF 时应保持各域展示模型稳定，组件原生对象 ID 只作为绑定键，不成为甲方业务语言。

## mock 与真实运行模式

交互原型不内置静态样例（演示数据文件已随 FE7 退役）。`VITE_DATAOS_DEMO_MODE=true` 只会打开运行状态横幅的「演示运行模式」标记，页面数据一律来自 API；视觉/交互演示建议配合合成契约替身：

```bash
node qa/mock-control-plane.mjs --port 18090 &   # 后台，从 prototype/ 目录运行
VITE_DATAOS_API_BASE_URL=http://127.0.0.1:18090/api VITE_DATAOS_DEMO_MODE=true npm run dev
npm run qa:mock
```

控制面运行状态通过 `/api/v1/system/status` 提供非敏感诊断信息；生产环境应使用 HTTP/DBT 质量执行器并配置 `DATAOS_QUALITY_EXECUTOR_BASE_URL`，`DEMO` 执行器只有在 `DATAOS_QUALITY_DEMO_ENABLED=true` 时才会生效。详见 [`docs/mock-production-readiness.md`](../docs/mock-production-readiness.md)。
