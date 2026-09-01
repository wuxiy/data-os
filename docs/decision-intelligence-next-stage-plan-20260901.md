# 下一阶段实施计划与验收清单：医疗指标语义与决策消费

> 日期：2026-09-01
> 状态：待批准
> 依据：`docs/decision-intelligence-roadmap-review-20260901.md`、G1–G14 验收事实、当前线上内测与快速迭代阶段
> 计划口径：附件是需求输入，不是实施指令；以仓库现状、已验收能力和本计划的 Gate 为准

## 一、建议结论

批准一个 **6–8 周、两条入口、条件推进** 的下一阶段：

1. **G15A：MPI 混合策略影子实验**——延续当前最确定的算法主线，只验证“V1 合取守卫 + V2 复核分流”，不切换生产决策权；
2. **G15B：Decision R0 产品准入**——在 10 个工作日内取得真实业务责任人、决策问题、指标和黄金问题；
3. **仅当 G15B 通过**，进入 **G16 医疗指标语义 MVP**；
4. **仅当 G16 通过**，进入 **G17 真实决策工作台**；
5. AI Analyst 与 Healthcare Pack 不属于本阶段实施范围，只保留后续准入条件。

这是一条推荐路径，不是两个产品线同时开工：G15A 是独立算法 Gate，G15B 是低成本产品决策门；G16/G17 由 G15B 单向解锁。

```text
当前 G14 基线
   ├── G15A MPI 混合策略影子实验 ──> 仅关闭 T5a；多源重标定 T5b 继续等待真实多源
   │
   └── G15B Decision R0 产品准入
             ├── 未通过 ──> 停止语义层开发，固定看板继续使用 Superset
             └── 通过 ──> G16 指标语义 MVP ──> G17 真实决策工作台
                                                     │
                                                     └── 采用证据达标后，另行评审 AI Analyst
```

## 二、阶段目标与非目标

### 2.1 本阶段目标

- 在不改变 MPI 生产决策的前提下，量化混合策略能否安全减少人工复核；
- 用真实业务 Owner 和黄金问题决定 Decision 主线是否值得开发；
- 若准入通过，让同一批已发布指标被 Superset、Data API 和门户一致消费；
- 把现有管理驾驶舱的一个主题改成真实数据闭环，并复用治理问题完成“发现—安排—复查”。

### 2.2 明确不做

- 不新增微服务、DuckDB 数据面、Connector、Edge Agent 或 NiFi Adapter；
- 不自研 Dashboard/Grid/Canvas 编辑器，不替代 Superset；
- 不把 `quality/dbt` 变成业务建模工程，语义模型使用独立的一次性 dbt 工程；
- 不实现 LLM、Text-to-SQL、报告生成或 Healthcare Pack；
- 不做全面压测、安全专项或生产加固；相关事项继续归口 `docs/deferred-hardening-backlog.md`。

## 三、排期与投入

按 4–6 人小组、现有线上内测工作仍需并行计算：

| Gate | 建议时长 | 估算投入 | 主要角色 | 前置条件 |
| --- | ---: | ---: | --- | --- |
| G15A MPI 混合策略影子实验 | 1–2 周 | 6–8 人日 | MPI 后端、数据/算法、验收 | G14 冻结语料与 dev 45 对 |
| G15B Decision R0 产品准入 | 最长 2 周 | 5–8 人日，不含业务访谈等待 | 产品/架构、数据工程、业务 Owner | 真实决策责任人可参与 |
| G16 医疗指标语义 MVP | 3 周 | 20–28 人日 | 控制面、数据工程、Data API、前端 | G15B 全部通过 |
| G17 真实决策工作台 | 2 周 | 12–18 人日 | 前端、控制面、分析、验收 | G16 全部通过 |

总投入约 **43–62 人日**。G15A/G15B 可并行；其余严格串行。最脆弱假设是：10 个工作日内能获得一个可持续参与验收的真实业务 Owner。该假设失败时，不延长概念设计，直接停止 G16/G17。

## 四、G15A：MPI 混合策略影子实验

### 4.1 范围

只验证如下保守策略，不增加可打开的生产开关：

| V1 结果 | V2 结果 | 混合候选结果 | 原则 |
| --- | --- | --- | --- |
| `HARD_CONFLICT` | 任意 | `HARD_CONFLICT` | 人工否决/拆分最高优先级 |
| `AUTO_MATCH` | 任意 | `AUTO_MATCH` | 自动合并仍由 V1 合取规则授权 |
| `NO_MATCH` | 任意 | `NO_MATCH` | 不扩大复核面 |
| `REVIEW` | `NO_MATCH` | 候选 `NO_MATCH` | V2 只用于减少低价值复核 |
| `REVIEW` | `REVIEW/AUTO_MATCH` | `REVIEW` | V2 永不单独授权自动合并 |

实现仍为影子证据：在评测报告和 dev 候选证据中记录 `hybridPolicy`，`mpi_match_result.outcome` 与现有复核任务均保持不变。

### 4.2 主要落点

- `services/mpi-service/src/main/java/.../matcher/`：新增单一 `MpiHybridPolicy`；
- `services/mpi-service/src/main/java/.../decision/MpiDecisionService.java`：仅追加影子证据；
- `services/mpi-service/src/test/java/.../matcher/MpiEvalHarnessTests.java`：增加混合策略评测；
- `services/mpi-service/eval/reports/`：保存 V1/V2/Hybrid 三方结果；
- `docs/validation/gate-mpi-g15a-<date>.md`：记录结论与 dev 证据。

### 4.3 验收清单

- [ ] 冻结语料、生成器 seed 与校验和未改变；重放逐字节一致；
- [ ] Hybrid 在 2142 对评测集上错误 `AUTO_MATCH` 为 0；
- [ ] V1 的全部 `AUTO_MATCH` 与全部 `HARD_CONFLICT` 逐对保持不变；
- [ ] Hybrid 将非同人复核量相对 V1 至少降低 70%，同时同人落入 `NO_MATCH` 不超过 1%；
- [ ] 4 条人工裁决锚点无错误自动合并，人工否决/拆分不被覆盖；
- [ ] dev 45 对全部写入可读的 `hybridPolicy` 证据，但数据库 `outcome`、黄金人和复核任务数量不因本策略改变；
- [ ] `mpi-service` Java 21 Maven 全量测试通过，既有公开 API 合同不变；
- [ ] Gate 结论只允许“继续影子”或“放弃策略”，不得宣称已完成真实多源重标定。

验收通过只关闭 T5 的“混合策略形态与影子实验”（T5a）；“真实多源接入后重标定与决策切换”（T5b）继续保留，直到至少两个来源系统具备可比身份字段和人工样本。

## 五、G15B：Decision R0 产品准入

### 5.1 交付物

- `docs/product/decision-pilot-brief-<date>.md`：角色、责任人、决策频率、现状耗时、决策动作与人工边界；
- `docs/product/decision-pilot-metrics-<date>.md`：5–10 张表与 8–12 个候选指标；
- `docs/product/decision-pilot-golden-queries-<date>.md`：至少 10 个用户问题、人工核验 SQL、结果摘要/校验和；
- `docs/validation/gate-decision-r0-<date>.md`：逐项准入结果与 Go/No-Go；
- 修正 `ProductScopeNotice` 及其 QA 锁，使 MPI、资产、分析与数据服务的已验收状态与 G3/G4/G6/G13 一致。

电子处方域只是首选技术载体，不得用它替代真实业务选题。业务 Owner 可以否决该域并选择另一组已经入仓且质量可用的数据。

### 5.2 准入清单（必须全过）

- [ ] 有一个具名业务角色、决策责任人和代理验收人，不只有技术 Owner；
- [ ] 决策至少每周发生一次，当前明确依赖 Excel/SQL/PPT，并记录单次耗时与当前基线；
- [ ] 明确结果将触发的业务动作，以及哪些动作仍需人工复核；
- [ ] 5–10 张表逐一记录 OpenMetadata FQN、数据 Owner、质量状态、最大数据时间和敏感分级；
- [ ] 8–12 个指标逐一记录代码、业务定义、公式、粒度、维度、默认过滤、单位、责任人、来源依据和使用限制；
- [ ] 至少 3 个指标明确需要被两个以上消费面复用；否则不建设语义层；
- [ ] 至少 10 个真实问题均有人工核验 SQL、固定时间窗、预期结果摘要或校验和；
- [ ] 产品范围提示与当前已验收模块状态一致，真实模式不再把已交付能力标成“规划”；
- [ ] 业务 Owner 对清单作出可追溯的 Go/No-Go 结论。

**No-Go 处理：** 不启动 G16/G17；固定看板需求直接交由现有 Superset 完成，已形成的问题与 SQL 作为后续发现材料，不创建空语义框架。

## 六、G16：医疗指标语义 MVP（条件 Gate）

### 6.1 架构与事实归属

```text
Git Manifest（定义源）
   ├── control-plane：版本、审批、发布、消费绑定
   ├── semantic/dbt + Doris：受控视图与计算结果
   ├── OpenMetadata：资产、Glossary、Owner、血缘引用
   ├── Superset：图表和 Dashboard 布局
   └── Data API：外部查询合同、Key、配额、调用审计
```

本 Gate 不做门户任意 SQL/Join 编辑器。Manifest 只能引用受控 dbt model、实体键、允许维度和聚合表达；Verified Query 只能由 Git 评审后导入。

### 6.2 最小实现

1. **声明仓库**
   - 新建 `semantic/pilots/<domain>/manifest.yaml` 与 `verified-queries.yaml`；
   - 增加 JSON Schema/校验脚本，覆盖 `Dataset / Entity / Dimension / Metric / Filter / GlossaryRef / VerifiedQuery`；
   - 指标版本不可变，版本号与内容 checksum 同时记录。
2. **计算模型**
   - 新建一次性 `semantic/dbt/` 工程，首批模型写入 Doris 独立语义 schema；
   - 不复用 `quality/dbt`，不新增常驻执行器；开发/部署仍由可审计的一次性脚本触发；
   - 数据 API 与 Superset 只读账号仅获得新语义视图所需的最小 SELECT。
3. **控制面模块**
   - 实现前先在 `CONTEXT.md` 定名“指标声明、指标版本、消费绑定、黄金问题”，并同步 `docs/technical-architecture.md` 的事实归属；
   - 在现有 control-plane 内新增 `semantic` 深模块，不建新服务；
   - Flyway `V14` 建立 `metric_manifest`（版本、状态、checksum、定义 JSON、审批/发布时间）与 `metric_consumer_binding`（消费者、外部引用、指标代码、版本）；
   - 生命周期：`DRAFT → APPROVED → PUBLISHED → DEPRECATED`；PUBLISHED 版本不可原地修改；
   - 管理 API 固定为 `POST /api/v1/metric-manifests/import`、`POST /{id}/approve|publish|deprecate`、`PUT /{id}/bindings`；读取 API 为 `GET /api/v1/metric-manifests`、`GET /api/v1/metrics`、`GET /api/v1/metrics/{code}`；完整路径均以 `/api/v1/metric-manifests` 或 `/api/v1/metrics` 为前缀，现有鉴权与租户范围继续生效；
   - 导入端点只接收 Git 中通过 schema 校验的完整版本，不提供网页端公式/SQL 编辑。
4. **现有消费者接入**
   - Superset seed 改为消费语义视图，并登记 Dashboard 与指标版本绑定；
   - Data API registry 增加可选 `semanticVersion/metricCodes` 投影；执行响应在现有 `columns/rows` 外增加兼容的 `metadata.semanticVersion`、`metricCodes`、`asOf`、`truncated`，调用证据记录相同版本；
   - OpenMetadata 只保存/读取 FQN、GlossaryRef 与血缘；当前 OM 缺陷时记录 `PENDING`，不复制第二套词汇表，也不阻断指标发布。
5. **只读呈现**
   - 指标目录作为现有分析/数据服务的二级视图，不新增一级导航；
   - 展示定义、Owner、版本、源表、dbt model、质量状态、最大数据时间、消费绑定和同步状态。

预计触达 25–40 个文件，跨 control-plane、Data API、portal、semantic/dbt、部署与文档；因此必须以 G16 单独 Gate 交付，不与 G17 页面改造混成一个大提交。

### 6.3 功能验收

- [ ] G15B 通过的 8–12 个指标全部进入 Manifest，字段完整且 schema 校验通过；
- [ ] 非法 Join、未登记维度、未知 GlossaryRef 格式、重复代码、版本倒退和 checksum 冲突在发布前被拒绝；
- [ ] 生命周期只允许主链流转；已发布版本不可修改或复活；
- [ ] 每个指标在固定时间窗及全部允许维度上的结果与人工核验 Doris SQL 逐项一致，数值误差为 0；
- [ ] Superset 至少一个 Dashboard 与 Data API 至少一个服务绑定同一 PUBLISHED 版本，不再各自维护独立指标公式；
- [ ] Data API 返回指标代码、语义版本、最大数据时间和截断信息，原有 Key、机构范围、配额与审计不回归；
- [ ] 指标可追到源表 FQN、dbt model、质量结果、Owner、GlossaryRef 与消费对象；
- [ ] OpenMetadata 不可用时发布结果标记为 `PENDING` 并可重试，指标目录不伪造已同步状态；
- [ ] Superset 不可用时指标目录和 Data API 仍可用；Data API 不可用时 Superset 与指标定义仍可读；
- [ ] 空结果、分母为 0、NULL 维度、起止日期相同、跨月和最大时间过旧均有明确结果或错误，不产生 `NaN/Infinity`；
- [ ] control-plane Maven、data-api pytest、semantic dbt build/schema tests、portal tsc/vitest/QA/build 全绿；
- [ ] dev 环境完成一次 `Manifest → 发布 → dbt 视图 → Superset + Data API → OM 引用` 的证据链验收。

## 七、G17：真实决策工作台

### 7.1 最小实现

- 只改造现有 `ManagementDashboardPage` 的一个已准入主题，不新建 Dashboard 编辑器；
- 复用 Superset embedded SDK 展示图表，门户补充指标版本、数据时间、Owner、口径和证据入口；
- 在治理域增加“来源于决策工作台”的人工问题创建入口，复用既有问题状态、事件、通知发件箱和复查流程；
- 新入口固定为 `POST /api/v1/governance/issues`，要求 `Idempotency-Key`，请求只接受 Owner、期限、严重度及受控来源证据，不接受任意执行 SQL；
- Flyway `V15` 仅为治理问题增加可选来源证据（metricCode、semanticVersion、filter、dashboardId、asOf），不新增第二套动作状态机；
- 增加运行配置开关；关闭时保留现有分析看板和管理驾驶舱边界，便于无损回滚。

### 7.2 验收清单

- [ ] 真实模式下该主题不读取 `mock.ts`，无 API 失败后的静态数据回退；演示模式仍明确标记演示数据；
- [ ] 页面展示的指标代码、数值、口径版本、统计范围和最大数据时间与 G16 发布版本一致；
- [ ] 用户可从异常指标下钻到至少机构/科室/日期三类证据，且能返回当前筛选上下文；
- [ ] 用户可将一项异常登记为治理问题，证据中包含 metricCode、semanticVersion、Dashboard、筛选范围和 asOf；
- [ ] 该问题完成“创建 → 分派/处理 → 通知 → 复查/关闭”并留存事件证据；
- [ ] 指标无数据、数据过旧、Superset 503、OpenMetadata 503、Data API 超时和权限拒绝均显示真实状态，不回退样例；
- [ ] 同一幂等键不会重复创建问题，跨租户/机构访问继续被现有范围约束拒绝；
- [ ] 1280×720 与 1440×900 桌面视口无根级横向溢出，抽屉/焦点/键盘交互复用现有 UI 原语；
- [ ] control-plane Maven、portal tsc/vitest/mock audit/interaction smoke/build 全绿；
- [ ] dev 环境由业务 Owner 完成一次真实任务验收，并记录现状耗时与新流程耗时，不以“页面可打开”代替采用证据。

## 八、跨 Gate 验收矩阵

| 场景 | 必须证明的行为 | 证据 |
| --- | --- | --- |
| 正常主链 | Manifest 发布后，Superset、Data API、门户读取同一版本与数值 | API 响应、SQL 对账、截图/浏览器记录、绑定清单 |
| 定义失败 | 非法定义、重复版本、越级发布被拒绝且不污染 PUBLISHED 版本 | 单测、HTTP 4xx、数据库状态 |
| 组件降级 | OM、Superset 或 Data API 任一不可用时，其余能力保持边界清晰 | 503/超时 smoke、门户不可用态 |
| 数据边界 | 空集、NULL、零分母、日期边界、过旧快照结果明确 | dbt tests、API 契约测试、浏览器回归 |
| 权限边界 | 租户、机构和既有 Data API Key 范围不被指标绑定绕过 | Java/Python 契约测试、审计记录 |
| 决策闭环 | 指标异常能形成带证据的治理问题并完成一次复查 | 问题详情、事件、通知、复查结果 |
| 回滚 | 消费者回绑上一 PUBLISHED 版本，旧 Dashboard/API 仍可用 | 回滚演练记录与前后对账 |

## 九、依赖、故障与回滚

### 9.1 外部依赖与凭据

- 不新增外部账号或密钥；复用现有 Doris 只读账号、Superset 服务账号/访客令牌、OpenMetadata 服务身份、Data API Key/OIDC 和门户 OIDC；
- 所有 secret 仍由部署机 0600 文件或环境注入，Manifest、dbt model 和验收报告不得包含值；
- G15B 的真正外部依赖是业务 Owner，而不是技术组件；Owner 不可用即 No-Go。

### 9.2 依赖失效时的设计形态

- OpenMetadata 失败：保存引用与 `PENDING` 同步状态，不卡发布，不造第二 Glossary；
- Superset 失败：指标目录和 Data API 独立可用，门户显示分析服务不可用；
- Data API 失败：Superset/指标定义仍可读，门户不伪造查询结果；
- 数据量放大 10 倍：仍由 Doris 承担查询，先通过 dbt 物化/预聚合调整；不引入第二数据面。系统性压测仍归 T1，只有当前功能 smoke 属本 Gate。

### 9.3 回滚

- G15A 全程影子，不改变生产 outcome；回滚只需停止写入/展示新证据；
- G16 的 Flyway 变更全部加法式，Published 版本不可覆盖；故障版本标记 DEPRECATED，消费者回绑上一版本；
- 新语义视图使用新 schema/名称，不覆盖 `ods_ep` 源表，旧 Superset Dashboard 和 Data API 定义保留到新链路验收后；
- G17 通过运行配置关闭真实主题，恢复现有分析入口；治理问题及审计证据不删除。

## 十、Gate 决策规则

| 决策点 | Go | No-Go / 停止 |
| --- | --- | --- |
| G15A → 后续 MPI 切换 | 影子指标满足门槛且真实多源样本到位后另立 Gate | 单源阶段不得切生产决策权 |
| G15B → G16 | 准入清单全过、业务 Owner 留痕确认 | 任一硬条件缺失即停止语义层 |
| G16 → G17 | 结果零误差、两个消费者同版本、失败态与回滚通过 | 口径分裂或只完成 CRUD 即停止 |
| G17 → AI Analyst 评审 | 真实用户完成闭环，使用频率与耗时改善有证据 | 只有演示、无采用或无法追溯则不进入 AI |

## 十一、阶段完成定义

本阶段只有两种合法完成状态：

1. **R0 No-Go 后正确停止**：G15A 完成影子结论，Decision 主线不开发，项目继续当前核心链路；
2. **G17 验收完成**：指标语义与一个真实决策主题形成可追溯闭环，但仍不宣称 AI Analyst 或通用 Decision Intelligence 平台已交付。

待本计划获批后，先创建并执行 G15A/G15B 的独立 Gate；在 G15B 结果出来前，不创建 G16 业务代码。
