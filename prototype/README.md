# 医数中枢第一版前端原型

面向医院信息中心、数据治理与业务管理人员的桌面端可点击原型。当前覆盖数据接入、管理/治理驾驶舱、标准与质量、主索引、数据资产、分析看板和智能问数十个路由页面。

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

## 核心路由

- `/`：医院数据运营总览
- `/ingestion`：数据源登记、采集任务和运行记录
- `/governance`：治理驾驶舱与责任链
- `/governance/standards`：数据标准
- `/governance/mapping`：标准映射
- `/governance/quality`：质量问题闭环
- `/mpi/review`：主索引候选审核
- `/assets`：数据资产、血缘影响和质量结果
- `/analysis`：嵌入式分析看板与指标证据
- `/assistant`：受控智能问数与查询证据

部署到静态服务器时，需要将以上前端路由统一回退至 `index.html`。

## 责任链来源

责任链通过 `issueId → assetId → ruleId → ownerId → ticketId` 关联生成：异常来自质量规则运行结果，数据对象来自资产目录与采集元数据，治理规则来自规则中心，责任部门来自资产责任人与组织主数据，处理结果来自治理工单。

治理驾驶舱已通过 `src/data/controlPlane.ts` 接入控制面；数据接入页同样读取数据源与采集任务 API，控制面不可用时明确降级为演示数据。其余页面当前数据位于 `src/data/mock.ts`。接入后端时，建议保持页面组件的展示模型不变，将 mock 数据替换为按页面聚合的 BFF/API 响应，避免前端直接拼接五类治理来源。

## 三类开源能力接入边界

- 分析看板：业务门户保留目录、范围和证据栏，中部受控视图由 BFF 签发短期嵌入凭证后加载 Superset；专业人员才进入原生编辑器。
- 数据资产：BFF 聚合 OpenMetadata 的资产搜索、实体详情、血缘、质量结果与责任人，不在业务门户复刻其管理后台；技术视图保留统一登录深链。
- 智能问数：data-os 承担会话、只读边界、证据和反馈，DB-GPT 仅作为可替换编排/执行能力；回答、SQL、来源资产和查询编号通过流式 API 返回。

三个页面的脱敏演示数据统一位于 `src/data/integrations.ts`。后续替换 BFF 时应保持 `DashboardItem`、`AssetItem`、`AssistantScenario` 展示模型稳定，组件原生对象 ID 只作为绑定键，不成为甲方业务语言。
