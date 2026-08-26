# G9 AI Ready Engine MVP 实施方案 — 2026-08-27

> 前置：`docs/architecture/ai-ready-data.md` §15-19/§27/§33-34/§39（引擎/Requirement/
> Profile/Gate/API/CLI/第一阶段范围）、G8 交付（域对象 + build 守护口
> `AIReadyEnginePort`）、总计划 `docs/ai-ready-iteration-plan-20260826.md` Gate 9。

目标：交付 `ai-ready-service`（Python 3.12/FastAPI，与 quality-runner 同栈同部署
形态）——Requirement/Profile 声明化加载、Doris + OpenMetadata 双 Adapter、6C 评分
聚合、Certification Gate；medical-rag/medical-training 双 Profile 共 10 个
Requirement 在**现有数据面**（ods_ep / dataos_mpi / OM 实体）全部可执行；
control-plane 实现 `AIReadyEnginePort` 打通「build → 评估 → readiness 回写」。

## 一、现状事实

| # | 事实 |
| --- | --- |
| 1 | G8 交付：`ai` 包域对象、V10 三表、五端点、build 守护（`ObjectProvider<AIReadyEnginePort>` 未装配 → 503）；门户 `/ai-data` 工作台 |
| 2 | 可评估的真实数据面：Doris `ods_ep`（5 表，G6 全入 OM）、`dataos_mpi`（3 表，含 G7 登记式列级血缘）、`dataos_quality_acceptance`；OM 1.5.11（资产/血缘/分类 PersonalData·PII·Tier 已存在，testDefinitions 端点损坏不影响本批） |
| 3 | quality-runner 提供同栈范本：FastAPI + PyJWT JWKS 验签（OIDC 服务间）、pyproject 锁版本、Dockerfile、.venv 测试（pytest/pytest-asyncio） |
| 4 | 架构规范：Requirement 六件套（Check/Diagnostic/Remediation/Weight/Severity/Applicable Profiles）；Assessment 四态 PASS/WARN/FAIL/NOT_APPLICABLE；Gate：<0.70 FAIL / 0.70-0.85 REVIEW / ≥0.85 候选 + Critical FAIL 一票否决；CLI 输出样式见 §34 |
| 5 | G10 前无 chunk/训练切分产物——部分 Requirement 在现数据面上预期输出 NOT_APPLICABLE（声明适用、执行结论 N/A，评分剔除） |

## 二、设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| G9-1 | 声明仓库 `ai-ready/`（repo 根）：`profiles/*.yaml` + `requirements/<dim>/<name>/{requirement.yaml, check.sql, fix.md}` + `policies/`；YAML 是评分口径唯一来源（Git 可评审），服务只加载不内置 | 「声明即 Git 资产」（总计划）；延续 rules.yml 先例 |
| G9-2 | 10 个 Requirement 与数据面映射（全部可执行）：Clean `data_completeness`（cfzb 关键列非空率）、`mpi_confidence`（match_result 三态质量）、`icd_mapping_coverage`（诊断/编码列覆盖）；Current `data_freshness`（edge 表 UPDATE_TIME 延迟）；Contextual `semantic_documentation`（OM 表描述覆盖）；Consumable `chunk_source_attribution`（目标表不存在→N/A，G10 生效）；Correlated `lineage_completeness`（OM 列级血缘边存在）；Compliant `pii_classification`（OM 敏感列 PII 标签覆盖，**Critical**）、`deidentification`（mpi 哈希列设计证据，**Critical**）、`patient_split_leakage`（训练切分表不存在→N/A） | 现有数据面能支撑真实结论；N/A 是架构一等状态，如实输出不硬造 |
| G9-3 | 评分：PASS=1.0 / WARN=0.5 / FAIL=0.0，N/A 剔除；维度分 = 维内 weight 加权平均；Overall = 有值维度等权平均；Gate 按架构 §27 阈值；Critical severity 的 FAIL → `certification: BLOCKED`（一票否决，不因总分掩盖） | 简单可解释可对拍；权重在 Profile 内按 requirement 声明 |
| G9-4 | 探针两种类型：`doris_metric`（check.sql 返回单行单列指标，YAML 声明 `metric/direction/pass/warn` 阈值）与 `om_probe`（内置探针函数：描述覆盖/血缘边/列标签，按 requirement id 路由）；只读账号执行（Doris 复用 `dataos_om_ro` 语义新开 `dataos_aird_ro` 或直接复用——**复用 `dataos_om_ro`**，只读三库已授权） | 声明式 SQL 检查可评审可扩展；不新增账号面 |
| G9-5 | `services/ai-ready-service/`：app/{main,api,catalog,engine,models,settings,security,cli}.py + adapters/{doris,openmetadata}.py；OIDC/JWKS 验签照抄 quality-runner 模式；`POST /assess {product,version,profile}`、`GET /readiness?product=`、`/healthz /readyz /metrics`；评估无状态（结果由 control-plane 持久化） | 同栈同部署同安全姿势；引擎无库，最小运维面 |
| G9-6 | control-plane `HttpAIReadyEngineAdapter implements AIReadyEnginePort`（`@ConditionalOnExpression("!'${data-os.ai-ready.base-url:}'.isBlank()")`）：build() → 调 /assess → 回写当前版本 `readiness_json` + `build_status=SUCCEEDED/FAILED`（Repository 加 `updateVersionReadiness`）；OIDC client credentials 复用 `OidcClientCredentialsTokenProvider` | G8 守护自动解除；readiness 落在版本上（G8 DDL 已留列） |
| G9-7 | CLI：`app/cli.py`（argparse，直调本地引擎库）：`python -m app.cli assess <product> --profile medical-rag`，输出对齐架构 §34 样式（6C 六行 + Overall + Result + 问题清单） | 验收点「CLI 输出与 §34 样例一致」；不走 HTTP 便于排障 |
| G9-8 | 部署：`deploy/dev/docker-compose.yml` 增 `ai-ready-service`（.env 增 DATAOS_AI_READY_*：base-url/oidc/doris/om）；AGENTS.md 注册子工程与命令（既定决策「G9 建服务时执行」） | — |
| G9-9 | pii_classification 的数据准备：幂等脚本给 `dataos_mpi` 敏感列（name_norm/card_no_norm/contact_hash/id_card_hash）打 OM `PersonalData` 分类标签（ingestion-bot API）——使该项真实 PASS 而非缺数据 FAIL；脚本进 Git | 「不把缺数据当不合格」：标签是治理动作，属数据准备非造假 |

## 三、实施步骤

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| E1 | `ai-ready/` 声明仓库：2 Profile + 10 Requirement（YAML+SQL+fix.md）+ policies | YAML 可被 catalog 加载（pytest 断言全量可解析、双 profile 各自 requirement 集正确） |
| E2 | `services/ai-ready-service/` 全量实现 + Dockerfile | 单测全绿（catalog/engine 聚合对拍/Gate 一票否决/CLI 格式） |
| E3 | control-plane：Adapter + readiness 回写 + 配置 + 契约测试 | mvn 全绿（既有零修改；503 守护语义在 base-url 配置后切换为真实调用） |
| E4 | 本地全绿：pytest + mvn + 前端（门户展示 readiness 分数——AIDataDetailPage 版本行显示 Overall/Result） | 三栈全绿 |
| E5 | 远端：镜像构建部署 + compose + PII 标签数据准备 + API/CLI 实测（10 项可执行、幂等重跑一致、无口令泄漏）+ AGENTS.md 注册 | 实测通过；截图 |
| E6 | gate 报告 + 提交推送 + 记忆 | 报告落库 |

## 四、验收清单（gate）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| A1 | 声明仓库 | 10 Requirement 全量加载可解析；双 Profile 的 requirement/weight/threshold 集正确；YAML 零口令 |
| A2 | 可执行性 | medical-rag 下 10 项全部产出结论（PASS/WARN/FAIL/N/A），无执行错误；N/A 项诊断说明 G10+ 生效条件 |
| A3 | 评分对拍 | 已知探针输入 → 6C/Overall/Gate 输出与手算一致（pytest 固定用例） |
| A4 | 一票否决 | Critical FAIL 时 Overall 无论高低 `certification=BLOCKED`（负向用例锁定） |
| A5 | 幂等与安全 | 同输入重跑结果逐字节一致；SQL/日志/响应零口令；Doris 只读账号 |
| A6 | control-plane 闭环 | build → 引擎评估 → 版本 readiness_json/build_status 回写；门户版本行显示分数与结论；引擎不可达时 build 503 明确报错 |
| A7 | CLI | 输出样式与架构 §34 一致（6C/Overall/Result/问题清单） |
| A8 | 回归 | pytest/mvn/前端全绿；G8 既有测试零修改；部署后既有链路零影响 |

## 五、边界与回滚

- 不做：数据加工（G10）、评测指标（G11）、OM 回写（G11）、medical-agent profile、自动 remediation。
- 回滚：ai-ready-service 容器下线 + control-plane base-url 置空（build 回到 503 守护语义）+ 前端 revert；声明仓库与表零影响。

## 六、延后清单

- 服务间限流/重试加固；Requirement 热加载；评估历史表（现为版本级 readiness_json 单值）；medical-agent/evaluation profile；OM 回写。
