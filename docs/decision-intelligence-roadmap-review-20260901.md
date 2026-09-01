# Decision Intelligence 功能必要性与 Roadmap 评审

> 日期：2026-09-01
> 评审对象：附件《Data-OS Decision Intelligence 模块设计方案》V0.1
> 评审口径：仓库 `main@35cf51a`、G1–G14 验收事实、当前线上内测阶段、当前官方行业实践
> 性质：产品/架构与 Roadmap 决策评审，未批准功能实施

## 一、决策结论

| 问题 | 结论 | 决策含义 |
| --- | --- | --- |
| 是否必要 | **有条件必要** | 真正必要的是“统一业务语义/指标 + 可追溯决策消费”；不是当前就建一套全功能 Decision Intelligence 产品线。 |
| 是否纳入总体 Roadmap | **纳入，但作为条件分支** | 先通过真实决策场景准入门，再依次做指标语义、真实驾驶舱、受控 AI 问数；未通过准入不进入开发。 |
| 是否适配当前项目 | **产品方向适配，附件实施方案不适配** | 当前已有 Superset、OpenMetadata、Doris/dbt、ToB Data API、AI Ready 和前置机链路；附件中的新 Connector、新 Edge Agent、DuckDB 运行时、NiFi Adapter、看板编辑器和仓库重组会重复建设。 |
| 是否符合行业最佳实践 | **原则大体正确，工程顺序需重写** | 统一指标、业务语义、AI 权限继承、行业包方向正确；最佳实践要求从小域、真问题、黄金查询和可量化评测开始，而不是从通用 BI/AI 能力清单开始。 |

**总结论：不批准附件 V0.1 原样开发；批准将“可治理的医疗指标语义与决策消费”纳入 Roadmap 候选。**

Decision Intelligence 暂不应宣布为已成立的新一级产品模块；应先作为现有 `analytics` / `dataservice` / `governance` / `assistant` 模块之间的受控消费闭环试点。当真实用户、采用频率和决策改进证明了独立价值，再升级导航层级和部署边界。

## 二、为什么方向必要，但不能原样立项

### 2.1 真正存在的缺口

1. **固定看板已真实，但指标不是跨消费面资产。** G4 已打通 Superset 嵌入与 Doris 数值对账，但现有图表口径仍主要存在于 Superset 数据集/图表中，还不能被 Dashboard、Data API 和 AI 以同一定义调用。见 [G4 验收](./validation/gate-analytics-g4-20260820.md)。
2. **数据消费有真实底座，但管理驾驶舱仍是演示面。** 门户的“医院数据运营总览”由 `DemoDataBoundary` 包裹，不应被当作真实决策产品。
3. **ToB Data API 已交付，但它消费的是 SQL 模板，不是统一指标查询。** G13 已有发布、权限、配额和审计闭环，它是新指标语义的现成消费者，不应被新平台取代。见 [G13 验收](./validation/gate-tob-data-api-g13-20260827.md)。
4. **AI 问数尚未有真实后端。** 当前门户仅是演示交互；该缺口值得进 Roadmap，但只能在指标口径、可用数据集、权限和黄金查询就绪后进入 Beta。

这些事实与已冻结的技术架构一致：一项指标要能追到口径、模型和源数据集；门户不复制 Superset 图表模型，问数只访问受控语义视图。见 [技术架构](./technical-architecture.md)。

### 2.2 附件将多个产品线包装成了一个功能

附件 V0.1 同时覆盖：

- Dataset 建模、Join、预览；
- 指标定义和同比/环比引擎；
- Dashboard 和可视化编辑；
- Excel/DB 连接器和 DuckDB 轻量运行时；
- Edge Agent 和 SeaTunnel/NiFi 适配；
- Text-to-SQL、图表/看板/报告生成；
- 新用户/角色/工作区/审计能力；
- 多行业 Pack 和四级商业化产品梯度。

对当前 4–6 人、医疗线上内测阶段，这不是 MVP，而是一次新产品线重构。它会抢占真实院端链路、MPI 效果、ToB API 和部署内测的当前优先级。

## 三、附件能力的取舍矩阵

| 能力 | 必要性 | 与现有能力关系 | Roadmap 决策 |
| --- | --- | --- | --- |
| Semantic Model / Metric Center | 高 | 存在真缺口；现有 `governance.Metric` 只是治理摘要 KPI | **纳入最小试点** |
| 真实管理驾驶舱 | 高 | 门户页面已有，实数链未有；Superset 嵌入已有 | **复用现有页面与 Superset 补真** |
| AI Analyst / Text-to-SQL | 中高 | 门户仅演示，架构已保留 `assistant` 边界 | **语义试点通过后 Beta** |
| Insight / Alert | 中 | 可复用指标时序、通知发件箱和已有运行事实 | **有真实阈值场景后做** |
| Report / Story | 中低 | 尚无已验证报表交付需求 | **后置** |
| Dashboard Editor / Data Screen | 低 | Superset 已有图表与 Dashboard 设计器 | **不自研** |
| Built-in Connector | 低 | 与 SeaTunnel、现有源/采集模块重复 | **不纳入** |
| 新 Edge Agent | 低 | 与已验证 MiNiFi Hospital Edge Relay 重复 | **不纳入** |
| NiFi Adapter | 低 | 违反已有 NiFi 服务端实验结论 | **除新证据外不纳入** |
| Decision Lite + DuckDB | 低 | 偏离当前医疗内测与 Doris 数据面，引入新部署矩阵 | **作为未来商业化发现项，不进工程 Roadmap** |
| One Platform, Multiple Experiences | 中高 | 与当前统一门户和角色分流一致 | **作为信息架构原则保留** |
| Healthcare Pack | 高（长期） | 符合项目医疗定位，但必须从真实医院产出 | **第一院指标试点后沉淀** |

## 四、与当前行业最佳实践的对照

### 4.1 方向正确的部分

- **指标要只定义一次。** dbt Semantic Layer 的官方目标就是将指标从 BI 层移到模型层，以中心定义保证下游一致；MetricFlow 还通过实体关系约束 Join，避免 fan-out/chasm join。[官方说明](https://docs.getdbt.com/docs/use-dbt-semantic-layer/dbt-sl) / [MetricFlow](https://docs.getdbt.com/docs/build/about-metricflow)
- **语义应以业务域与用户问题设计。** Snowflake 官方指南建议首个 PoC 只选 5–10 张表，围绕一个业务域、显式定义关系/指标/过滤，并以真实问题持续评测。[官方指南](https://docs.snowflake.com/en/user-guide/views-semantic/best-practices-modeling)
- **AI 问数需要黄金查询和回归集。** Verified Query Repository 将用户问题与人工验证 SQL 成对，以提高结果可信度。[官方说明](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)
- **Glossary/Contract 不应在新模块重建。** OpenMetadata 已提供受控词汇、同义词、审批与资产关联；Data Contract 可统一 schema、semantics、quality、SLA、security 和 terms of use。[Glossary](https://docs.open-metadata.org/v1.12.x/how-to-guides/data-governance/glossary) / [Data Contract](https://docs.open-metadata.org/v1.12.x/how-to-guides/data-contracts/spec)
- **医疗指标是版本化知识制品，不只是 SQL。** HL7 FHIR `Measure` 将临床质量、公共卫生和人群分析指标表达为结构化、可计算定义，包含使用说明、分层和独立逻辑库引用。data-os 无需把所有经营指标都做成 FHIR，但医疗质量/公卫指标应预留等价的版本、人群口径、依据和计算逻辑。[FHIR Measure](https://fhir.hl7.org/fhir/measure.html)

### 4.2 需要纠正的行业实践判断

1. **不要因为行业在做 Semantic Layer，就立刻引入新运行时。** dbt 官方 Semantic Layer 属于 Starter/Enterprise 能力；Superset 接入外部 Semantic Layer 当前仍为实验 feature flag。对离线交付、开源优先和 dbt-doris 项目，必须先 spike，不能将其直接写入验收承诺。[Superset 语义层说明](https://superset.apache.org/user-docs/using-superset/creating-your-first-dashboard/)
2. **不要让 Superset 的“薄语义”成为全平台指标事实源。** 它可作为看板消费适配，但 Dashboard、API 与 AI 共用的定义应位于 data-os 可评审的语义/指标声明。
3. **AI 权限不只是“给生成 SQL 加一个 WHERE”。** 必须同时限制可见语义对象、可访问列、行范围、最大时间窗/行数/执行时间、导出、会话记录和证据回传；对不确定或越界问题必须拒答/澄清。

## 五、建议目标架构：增量语义脊柱，不建第二平台

```text
真实决策问题 / 业务责任人
              │
              ▼
可评审 Semantic + Metric Manifest（Git）
              │
              ├── 发布投影 / 版本 / 审批（control-plane）
              ├── 计算模型 / 受控视图（dbt + Doris）
              ├── 资产 / Glossary / 血缘引用（OpenMetadata）
              ├── Dashboard 消费（Superset + 现有嵌入）
              ├── API 消费（现有 Data API）
              └── AI 消费（未来 AssistantAdapter，只读）
```

### 5.1 事实归属

| 事实 | 建议唯一归属 | 说明 |
| --- | --- | --- |
| 指标代码、版本、公式、时间粒度、维度、默认过滤、责任人、敏感分级、用途 | data-os Semantic/Metric Manifest + control-plane 发布投影 | 声明进 Git 可审核；控制库承接发布生命周期与门户读模型 |
| 实体键、Join 路径和物化计算 | dbt + Doris | 不在门户维护任意 SQL/Join |
| 资产、业务术语、Owner、血缘 | OpenMetadata | 继续单一元数据中心；指标只保存引用，不复制 Glossary 编辑 |
| 图表与 Dashboard 布局 | Superset | data-os 仅保存绑定、业务目录、口径引用和可见范围 |
| ToB 查询合同、Key、配额、调用审计 | 现有 `dataservice` 域 | 不新建 API/MCP 网关 |
| AI 会话、生成 SQL、查询证据、用户反馈 | 未来 `assistant` 域 | 模型/问数引擎是 Adapter，不成为业务事实源 |

### 5.2 本轮不应引入的技术

- 不引入 DuckDB 作为第二分析数据面；
- 不新建 Built-in Connector 和第二 Edge Agent；
- 不增加 NiFi 服务端适配；
- 不自研 Dashboard/Grid/Canvas 编辑器；
- 不为新域切换 MyBatis-Flex 或重排五个子工程；
- 不在未做 dbt-doris/私有化 spike 前把 dbt Semantic Layer 写入默认产品依赖。

## 六、建议 Roadmap

### R0：准入与产品基线同步（现在，不写业务代码）

准入条件必须同时满足：

1. 一个真实用户角色与决策责任人（例如医务、门诊、信息中心）；
2. 一个高频且当前依赖 Excel/SQL/PPT 的决策问题；
3. 5–10 张已入仓、有责任人、有口径依据的表；
4. 8–12 个需要跨 Dashboard/API/AI 复用的指标；
5. 至少 10 个来自用户的代表性问题及人工核验 SQL/结果；
6. 明确什么决策仍必须人工复核，AI 只做辅助分析。

未找到责任人、只需要一张固定看板，或指标不需要跨消费面复用时，**直接停止新语义层建设，用现有 Superset 完成需求**。

R0 还应修正产品基线口径：当前 `ProductScopeNotice` 仍把 MPI、资产、分析和数据服务标记为“规划/待接入”，与 G3/G4/G6/G13 的已验收事实不一致。

### R1：医疗指标语义 MVP（条件 Gate）

选用 G4 已对账的电子处方域作为首个技术载体，但指标必须由真实业务责任人确认。

交付边界：

- `Dataset / Entity / Dimension / Metric / Filter / GlossaryRef / VerifiedQuery` 最小声明模型；
- `DRAFT → APPROVED → PUBLISHED → DEPRECATED` 发布生命周期；
- 指标计算结果与已验证 Doris SQL 全量对账；
- Superset 与现有 Data API 各至少一个真实消费者；
- 指标可追到业务责任人、源表、dbt model、质量结果、最大数据时间和使用限制；
- 本 Gate 不引入 LLM、不新建图表工具。

### R2：真实 Decision Workspace

将现有“医院数据运营总览”的一个明确主题改为真实指标消费，不重做 Superset 编辑器。验收不是“页面更好看”，而是：

- 指标口径与已发布 Metric 一致；
- 异常可下钻到机构/科室/日期与数据证据；
- 每项数据显示统计范围、最大数据时间、责任人与口径版本；
- 至少一项真实决策流程从“发现 → 分析 → 安排动作 → 复查”留下证据。

### R3：受控 AI Analyst Beta

只在 R1/R2 通过后开始。引擎继续作为 `AssistantAdapter`，不预先锁定 DB-GPT 或其他产品。

准入门：

- 只能访问 PUBLISHED 语义对象与受控只读视图；
- 所有结果返回指标版本、数据集、SQL/查询计划、执行时间、数据最大时间与截断说明；
- 黄金问题集上结果与人工验证基线一致，版本变更必须回归；
- 越权、不可回答、口径歧义和高风险问题稳定拒答/要求澄清；
- 不允许 DDL/DML、多语句、无界明细、跨租户或绕过 PHI 限制的查询；
- AI 回答不自动修改指标、治理规则、主数据或生产决策。

### R4：Healthcare Pack 与采用扩展

仅将通过真实试点的 Metric、Dimension、Glossary 引用、映射、Dashboard 绑定和 Verified Query 纳入 Healthcare Pack。每个包必须声明适用地区/机构、标准依据、版本和本地化参数，不把一院口径冒充行业标准。

## 七、关键风险与决策门

| 风险 | 信号 | 决策/止损 |
| --- | --- | --- |
| 口径事实源分裂 | 同一指标在 Superset、Data API、AI 出现三段公式 | 停止增加消费者，先收敛到一个 PUBLISHED Metric |
| 产品无人负责 | 指标只有技术 Owner，没有业务 Owner | 不得进入 R1 |
| 只有演示价值 | 没有真实用户问题、使用频率和人工时间基线 | 不得进入 R2/R3 |
| AI 结果无法验证 | 只评价“能回答”，不对账结果/拒答行为 | 不得从 Beta 转可用 |
| 技术树扩张 | 为 Lite 引入 DuckDB/新 Connector/新 Edge 运行时 | 需单独商业用例与 ADR，不合并进本 Roadmap |
| OM 版本缺陷拖住 MVP | 语义发布被 `glossaryTerms` 缺陷阻塞 | R1 保存 GlossaryRef 与待同步状态，不新建第二 Glossary；OM 升级继续归口下一阶段备忘 P3 |

## 八、最终建议

1. **批准方向，不批准附件的原始 V0.1 Scope。**
2. **Roadmap 中将其改名为“医疗指标语义与决策消费”条件主线**，避免用一个庞大名称隐藏多产品线。
3. **当前不直接排实施 Gate，先执行 R0 产品准入。** 已有 T5（MPI 混合决策权与多源重标定）是明确的下个 Gate 候选；不应因为一份宏大方案自动替换已有核心优先级。
4. **R0 通过后，R1 应只在现有模块上做最小增量**：不新增数据面、采集引擎、前置机、BI 编辑器或微服务。
5. **AI Analyst 必须以语义覆盖、黄金问题、权限证据与回归评测为准入门**，不以“LLM 能生成 SQL”作为完成标准。

这样可以保留附件中最有价值的产品方向，同时守住 data-os 当前的医疗背景、单一事实归属、小团队交付和真实闭环纪律。
