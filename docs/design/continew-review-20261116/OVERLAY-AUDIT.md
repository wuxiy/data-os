# 抽屉、弹窗与工作页使用盘点

日期：2026-11-16。正式门户源码基线：`64aa39b`。

**这是后续正式迁移建议，未在正式门户全量实施。** 本轮只在独立审核原型呈现代表场景：数据源短表单 Dialog、新建任务独立页、质量规则删除 AlertDialog、保留对象详情 Sheet。下表不是已完成迁移清单，不改变正式门户技术栈或业务行为。

## 统计与判断原则

全量检索 `prototype/src`：24 个 antd `Drawer`，分布在 12 个页面文件；另有责任链和命令面板 2 个自绘 `role="dialog"`，共 **26 个覆盖层定义**。未发现 antd `Modal`、`Popconfirm` 或原生 `window.confirm/alert/prompt` 调用。统计按 JSX 入口定义计数，不按每条数据行或每次打开计数。

| 当前覆盖层 | 数量 | 下表建议去向 | 数量 |
|---|---:|---|---:|
| antd Drawer | 24 | Drawer / Sheet | 5 |
| 自绘对话层 | 2 | 中心 Dialog | 9 |
| — | — | AlertDialog | 2 |
| — | — | 独立工作页 | 9 |
| — | — | 内联工作区 | 1 |
| 合计 | **26** | 合计 | **26** |

- **Drawer / Sheet**：依附当前列表对象的快速详情、证据和历史，关闭后回到原筛选与选中项。
- **中心 Dialog**：短、聚焦、一次完成的输入或检查，不需要长期查看背景列表。
- **AlertDialog**：确认具体对象、影响范围与后果，适用于删除、服务中断或批量通知；不承载复杂配置。
- **独立工作页**：多步骤、动态长表单、SQL/JSON、库表浏览、宽结果、日志和完整审计。
- **内联工作区**：需持续比较、编辑后立即验证、观察异步结果的核心任务。

抽屉也可能是模态层。背景列表可见不等于可同时操作；需边选边比较时，使用常驻侧面板或主从工作区。容器选择依据任务，不以“后台统一使用抽屉”作为规则。普通可逆保存不额外增加确认。

## 全部 26 个覆盖层入口

| # | 模块 / 当前标题与源码 | 内容、上下文与动作特征 | 后续建议 |
|---:|---|---|---|
| 1 | 数据接入：[新增数据源，DataIngestionPage.tsx:843](../../../prototype/src/pages/DataIngestionPage.tsx#L843) | 3 字段，单步登记；不需对照其他行 | **Dialog** |
| 2 | 数据接入：[新建采集任务，DataIngestionPage.tsx:873](../../../prototype/src/pages/DataIngestionPage.tsx#L873) | 来源、执行通道、配置形态、库表多选、SQL/JSON、列白名单、增量配置；多阶段依赖 | **独立创建页**；分步骤且保留完整配置能力 |
| 3 | 数据接入：[数据源检查，DataIngestionPage.tsx:942](../../../prototype/src/pages/DataIngestionPage.tsx#L942) | 检查 JSON、前次结果；一次请求到结果；无需列表对照 | **Dialog** |
| 4 | 数据接入：[数据源浏览，DataIngestionPage.tsx:958](../../../prototype/src/pages/DataIngestionPage.tsx#L958) | 库树、字段表、SQL、查询结果；首次另需连接登记 | **独立工作页**；连接登记可单独 Dialog |
| 5 | 数据接入：[任务配置，DataIngestionPage.tsx:969](../../../prototype/src/pages/DataIngestionPage.tsx#L969) | 动态长表单、库表/列选择、SQL/JSON、水位；持续编辑 | **独立任务页 · 配置 Tab**；仅两个调度绑定编号可 Dialog |
| 6 | 数据接入：[任务复制，DataIngestionPage.tsx:1017](../../../prototype/src/pages/DataIngestionPage.tsx#L1017) | 目标来源、副本名称共 2 字段；单步创建草稿 | **Dialog** |
| 7 | 数据接入：[运行详情，DataIngestionPage.tsx:1035](../../../prototype/src/pages/DataIngestionPage.tsx#L1035) | 最近 10 次运行、状态、时间、对账、重试；需保持列表选中项 | **Drawer / Sheet**；完整历史/日志可进入任务页 |
| 8 | 数据接入：[调度配置，JobScheduleDrawer.tsx:292](../../../prototype/src/pages/JobScheduleDrawer.tsx#L292) | 配置/实例两 Tab；CRON、触发预览、生效窗口、补数、任务、日志、删除 | **独立任务页 · 调度/实例 Tab** |
| 9 | 前置机：[版本登记与历史，EdgeNodesPanel.tsx:282](../../../prototype/src/pages/EdgeNodesPanel.tsx#L282) | 当前节点的 3 字段追加记录和发布历史；依附节点上下文 | **Drawer / Sheet**；登记表单内联 |
| 10 | 前置机：[登记/编辑前置机节点，EdgeNodesPanel.tsx:324](../../../prototype/src/pages/EdgeNodesPanel.tsx#L324) | 7 个短字段，单步保存；无需浏览其他节点 | **Dialog**；两列短表单 |
| 11 | 数据质量：[批量提醒，QualityIssuesPage.tsx:352](../../../prototype/src/pages/QualityIssuesPage.tsx#L352) | 无表单；确认数量、范围和通知行为 | **AlertDialog** |
| 12 | 数据质量：[通过线/维度权重/等级，QualityScorePanel.tsx:177](../../../prototype/src/pages/QualityScorePanel.tsx#L177) | 全局配置；多个维度权重、可增减等级，保存并重算 | **独立配置页**；保存处呈现影响摘要 |
| 13 | 数据质量：[新建/编辑动态规则，QualityRulesAdmin.tsx:399](../../../prototype/src/pages/QualityRulesAdmin.tsx#L399) | 多种规则动态参数、SQL、跨表比较、证据列数组、脱敏策略 | **独立规则编辑页** |
| 14 | 数据质量：[删除规则确认，QualityRulesAdmin.tsx:531](../../../prototype/src/pages/QualityRulesAdmin.tsx#L531) | 无输入表单；不可撤销，摘除执行器规则并保留既有历史 | **AlertDialog**；不能用整张抽屉承担两段确认 |
| 15 | 患者主索引：[黄金人详情，MpiReviewLive.tsx:332](../../../prototype/src/pages/MpiReviewLive.tsx#L332) | 身份链接表、最近 20 条审计；依附候选复核上下文；含拆分动作 | **Drawer / Sheet**；拆分另设 AlertDialog |
| 16 | AI 数据：[新建 AI 数据产品，AIDataPage.tsx:295](../../../prototype/src/pages/AIDataPage.tsx#L295) | 5 个短字段，创建草稿和初始版本，单步 | **Dialog** |
| 17 | AI 数据：[反馈失败样本，AIDataDetailPage.tsx:488](../../../prototype/src/pages/AIDataDetailPage.tsx#L488) | 单个文本域；产品/评测上下文明确；提交学习队列 | **Dialog** |
| 18 | 问数治理：[新建/编辑已验证问题，AssistantGovernance.tsx:400](../../../prototype/src/pages/AssistantGovernance.tsx#L400) | 代码、服务绑定、原文/别名、动态参数 Schema、回答模板；长编辑 | **独立问题编辑页** |
| 19 | 问数治理：[试运行问题，AssistantGovernance.tsx:480](../../../prototype/src/pages/AssistantGovernance.tsx#L480) | 参数、通过/拒答、答案和明细；需与问题配置往返核对 | **编辑页内联试运行区/Tab**；保留参数和结果 |
| 20 | 问数治理：[事件留痕，AssistantGovernance.tsx:549](../../../prototype/src/pages/AssistantGovernance.tsx#L549) | 单个问题的事件分页，从清单快速查阅 | **Drawer / Sheet** |
| 21 | 问数治理：[问数审计，AssistantGovernance.tsx:573](../../../prototype/src/pages/AssistantGovernance.tsx#L573) | 跨问题检索、结局筛选、分页、导出；独立审计任务 | **独立审计页** |
| 22 | 数据服务：[新建数据服务，DataServicesPage.tsx:299](../../../prototype/src/pages/DataServicesPage.tsx#L299) | 9 个配置项，含 SQL、参数 JSON、列 JSON、上限和超时 | **独立服务编辑页**；定义、契约、校验分区 |
| 23 | 交付中心：[新建交付项目，DeliveryCenterPage.tsx:357](../../../prototype/src/pages/DeliveryCenterPage.tsx#L357) | 代码、名称、负责人、日期、范围共 5 字段；单步创建草稿 | **Dialog** |
| 24 | 交付中心：[引用交付对象，DeliveryCenterPage.tsx:407](../../../prototype/src/pages/DeliveryCenterPage.tsx#L407) | 类型、标识、备注共 3 字段；单步追加当前项目 | **Dialog** |
| 25 | 全局：[责任链详情，ResponsibilityChain.tsx:148](../../../prototype/src/components/governance/ResponsibilityChain.tsx#L148) | 五节点、来源、关联键；从异常定位证据，依附事件上下文 | **Drawer / Sheet** |
| 26 | 全局：[命令面板，CommandPalette.tsx:127](../../../prototype/src/components/ui/CommandPalette.tsx#L127) | 全局搜索与跳转，短暂任务 | **中心 Dialog**；保留键盘操作 |

数据源浏览和结构化任务的复杂度另见 [SourceExplorer.tsx:27](../../../prototype/src/pages/SourceExplorer.tsx#L27)、[JobStructuredForm.tsx:31](../../../prototype/src/pages/JobStructuredForm.tsx#L31)，不是依据抽屉标题推测。

## 六种既有行内二次确认

以下是覆盖层统计之外的动作模式，不增加上表入口数。建议在正式迁移时使用具名 AlertDialog，展示对象、影响与取消动作，避免只在原位置把按钮文本替换成“确认”。可恢复的停用与永久删除应使用不同后果说明。

| 动作 | 当前实现与源码 | 后续确认重点 |
|---|---|---|
| AI 产品撤下重评估 | [AIDataDetailPage.tsx:328](../../../prototype/src/pages/AIDataDetailPage.tsx#L328)，按钮变成确认撤下/取消 | 当前服务版本、服务中断及后续重评路径 |
| AI 产品弃用 | [AIDataDetailPage.tsx:335](../../../prototype/src/pages/AIDataDetailPage.tsx#L335)，确认弃用/取消 | 产品与版本、生命周期后果 |
| 数据服务下线 | [DataServicesPage.tsx:518](../../../prototype/src/pages/DataServicesPage.tsx#L518)，确认下线/取消 | 服务代码、调用执行面影响、历史与合同保留 |
| 已验证问题删除 | [AssistantGovernance.tsx:332](../../../prototype/src/pages/AssistantGovernance.tsx#L332)，第二次点击调用删除 | 问题代码、删除对象与保留的审计 |
| 已验证问题停用 | [AssistantGovernance.tsx:340](../../../prototype/src/pages/AssistantGovernance.tsx#L340)，第二次点击调用停用 | 问数面可见性；与永久删除区分，可重新起草 |
| 删除任务调度 | [JobScheduleDrawer.tsx:268](../../../prototype/src/pages/JobScheduleDrawer.tsx#L268)，4 秒内再次点击删除 | 仅删除周期计划，任务回到手动调度，不等同删除任务或终止实例 |

### MPI 拆分与核心复核

[黄金人身份表的拆分按钮，MpiReviewLive.tsx:324](../../../prototype/src/pages/MpiReviewLive.tsx#L324) 当前直接调用拆分。建议只把详情阅读保留为 Sheet，拆分另用 AlertDialog，明确源身份、当前黄金人及操作后果；不把整张 Sheet 当作危险动作确认。

[MPI 核心复核，MpiReviewLive.tsx:247](../../../prototype/src/pages/MpiReviewLive.tsx#L247) 包含逐字段证据、操作影响和人工核对复选框。该任务继续常驻页面，保持双身份宽对照；不能为了统一容器压进短弹窗。人工确认不同人会形成终态否决，确认同人会并入黄金人，需保持现有真实语义。

## 常驻详情面与独立深链

| 业务场景 / 当前源码 | 后续建议 |
|---|---|
| [质量问题队列、详情、证据、处理与复检，QualityIssuesPage.tsx:277](../../../prototype/src/pages/QualityIssuesPage.tsx#L277) | 常驻主从工作区；持续核查证据、说明与异步结果 |
| [MPI 身份对照、证据、操作影响，MpiReviewLive.tsx:232](../../../prototype/src/pages/MpiReviewLive.tsx#L232) | 常驻宽复核页；黄金人详情才是辅助 Sheet |
| [标准版本、数据元、草稿编辑、比较与影响，DataStandardsLive.tsx:250](../../../prototype/src/pages/DataStandardsLive.tsx#L250) | 标准详情工作页/主从布局；核心编辑不叠加抽屉 |
| [标准导入、预检报告与落库，DataStandardsLive.tsx:411](../../../prototype/src/pages/DataStandardsLive.tsx#L411) | 导入 Tab/步骤工作区，报告与结果留在页面 |
| [映射集创建，StandardMappingLive.tsx:239](../../../prototype/src/pages/StandardMappingLive.tsx#L239) | 5 字段短创建可用 Dialog |
| [映射版本、字段映射、验证证据与评审，StandardMappingLive.tsx:293](../../../prototype/src/pages/StandardMappingLive.tsx#L293) | 完整映射工作页，导入预检/版本验证留在工作区 |
| [资产目录、字段、质量与血缘，AssetCatalogLive.tsx:229](../../../prototype/src/pages/AssetCatalogLive.tsx#L229) | 常驻主从；保持资产选择和查询条件 |
| [资产技术视图，AssetTechnicalLive.tsx:96](../../../prototype/src/pages/AssetTechnicalLive.tsx#L96) | 保留独立技术深链与返回资产详情入口，提供宽字段/血缘空间 |
| [AI 版本、评测/对比、反馈、认证、构建，AIDataDetailPage.tsx:349](../../../prototype/src/pages/AIDataDetailPage.tsx#L349) | 完整产品详情页，按业务 Tab 收拢；认证与评估结果分别留痕 |
| [数据服务定义、Key 和运行记录，DataServicesPage.tsx:507](../../../prototype/src/pages/DataServicesPage.tsx#L507) | 服务详情常驻；短 Key 授权表单可内联/Dialog |
| [交付项目与验收详情，DeliveryCenterPage.tsx:299](../../../prototype/src/pages/DeliveryCenterPage.tsx#L299) | 保留项目目录和宽验收区 |
| [看板目录与嵌入，AnalyticsLive.tsx:143](../../../prototype/src/pages/AnalyticsLive.tsx#L143) | 完整分析工作区，避免嵌入内容套模态层 |
| [问数参数、结果和证据，AssistantLive.tsx:195](../../../prototype/src/pages/AssistantLive.tsx#L195) | 完整主工作区；宽结果表与证据持续可见，专业工作区保持独立路由 |

## 原型文案必须遵守的当前业务事实

### 删除质量规则

当前确认文案见 [QualityRulesAdmin.tsx:544](../../../prototype/src/pages/QualityRulesAdmin.tsx#L544)：

> 规则将被删除，并从质量执行器同步摘除，已产生的治理问题与运行记录保留。此操作不可撤销；如需暂停执行请使用「停用」。

具体限制与实现边界：

- 管理的是当前租户/机构内的**动态质量规则**。服务先查当前范围的规则，调用执行器摘除，再删除台账；见 [QualityRuleAdminService.java:118](../../../services/control-plane/src/main/java/com/cywu/dataos/controlplane/quality/QualityRuleAdminService.java#L118)。
- 前端确认时显示规则编号、类型、数据集和目标列；有动作执行中时禁止确认及取消；见 [QualityRulesAdmin.tsx:535](../../../prototype/src/pages/QualityRulesAdmin.tsx#L535)。
- 当前删除路径**没有“必须先停用”“存在引用就禁止删除”“运行中自动拦截”检查**。不得在审核原型里把这些未实现规则写成现有事实。若后续要新增，单独设计并做服务端校验。
- 「停用」是保留台账并从执行器停用规则；见 [QualityRuleAdminService.java:105](../../../services/control-plane/src/main/java/com/cywu/dataos/controlplane/quality/QualityRuleAdminService.java#L105)。它与删除不是同一个动作。

### 暂停采集任务

当前「暂停」是把任务生命周期改为 `PAUSED`，不是暂停/终止正在运行的执行批次。

- 前端发送状态更新，暂停后主操作变为「启用」，禁止新启动与重试；见 [DataIngestionPage.tsx:325](../../../prototype/src/pages/DataIngestionPage.tsx#L325)、[DataIngestionPage.tsx:739](../../../prototype/src/pages/DataIngestionPage.tsx#L739)。
- 后端 `changeStatus` 只更新任务状态，不调用外部执行器取消；见 [JobService.java:62](../../../services/control-plane/src/main/java/com/cywu/dataos/controlplane/job/JobService.java#L62)。新运行领取时明确拒绝 `PAUSED`；见 [IngestionRunService.java:114](../../../services/control-plane/src/main/java/com/cywu/dataos/controlplane/job/IngestionRunService.java#L114)。
- 已提交/执行中的批次不会因此终止。平台周期调度的「下线」是独立操作；任务暂停没有联动下线调度；见 [JobScheduleService.java:120](../../../services/control-plane/src/main/java/com/cywu/dataos/controlplane/job/JobScheduleService.java#L120)。因此不能声称任务暂停会停止平台调度的所有后续执行。
- 原型可用文案：「暂停后无法从门户启动或重试；已运行批次继续执行。周期调度需在调度配置中另行下线。」普通任务暂停不套用删除规则的“不可撤销”确认。

## 核验范围

本文件根据当前源码全量检索及逐项内容读取编制；覆盖层入口、六种确认与上述后端语义均已核对。文件相对链接从本目录回到仓库根使用 `../../../`。本轮未据此修改正式门户或后端，未把设计建议当成已实现行为，也未把独立审核原型的合成数据当成真实业务验证。
