# G21–G26 功能补齐验收清单

> 日期：2026-09-20
> 依据：[feature-completion-iteration-plan-20260920.md](feature-completion-iteration-plan-20260920.md)（同日计划，状态：待用户批准）
> 性质：本文只把计划中散落各节的验收条件**编号化、可勾选化**，不改变计划范围与裁决；计划现状断言的核对结论见附录 A。
> 用法：每个 Gate 收口时出一份 `docs/validation/gate-g2x-<date>.md`，逐项引用本清单编号（如 `G21-1a`）并附证据（测试输出、HTTP 证据、截图、commit 哈希）。勾选状态在 gate 文档中维护，本文保持未勾选基线。

## 0. 通用门槛（每个 Gate 都必须过）

- [ ] C-1 行为保持：既有测试零修改全绿；新功能带可运行的验证（AGENTS.md 验收门槛）
- [ ] C-2 统一验证矩阵八项逐项有证据：正常主链 / 非法流转 / 数据边界 / 权限边界 / 依赖故障 / 幂等并发 / 隐私 / 回滚
- [ ] C-3 隐私红线：API、日志、证据包不出现 PHI、Secret、连接串或任意原始样本行
- [ ] C-4 提交纪律：功能迭代不混入 H4/H5 事项；新发现的安全/加固/深测只记 `docs/deferred-hardening-backlog.md`，不自动扩项
- [ ] C-5 门户改动全链：`npx tsc -b && npx vitest run && node qa/mock-audit.mjs && node qa/portal-interactions-smoke.mjs && npm run build`（从 prototype/ 运行）
- [ ] C-6 浏览器验证：1440×900 为主、1280px 最小桌面宽度；真实模式与显式演示模式均覆盖
- [ ] C-7 开发环境真实链路证据（不止本地测试）；独立回滚路径已记录

## G21 功能可信基线（必须最先；6–9 人日）

现状核对（证据见附录 A.1）：远端 CI 最近 8 次全红，三个失败 job 根因已定位，与计划诊断一一对应。

- [ ] G21-1 远端 CI 修复，同一提交全绿：
  - [ ] G21-1a control-plane 3 个失败测试：`ControlPlaneApiTest.submissionResultMustBeWrittenByCurrentLeaseOwner`、`DataServiceExportTest.exportLifecycleCreateClaimFinalizeExpire`、`DataApiAdminServiceTest.recordCallIsIdempotentAndFeedsUsageAndAudit`（先判定产品缺陷 vs 测试脆弱：产品缺陷修产品，脆弱测试修测试并在 gate 文档说明理由）
  - [ ] G21-1b quality-runner：CI 安装步骤补 `httpx`（现状 `test_security.py` 收集即 `ModuleNotFoundError: No module named 'httpx'`；`pyproject.toml` 已声明 httpx==0.28.1，属 CI 安装列表缺项）
  - [ ] G21-1c 生产 manifest 校验：CI 中 `DATAOS_AI_READY_OIDC_CLIENT_SECRET` 缺值（Validate DolphinScheduler overlays 步骤 interpolate 失败）——用非秘密测试占位补齐，不得引入真 secret
- [ ] G21-2 Data API 导出 claim 正确性（以测试覆盖证明）：
  - [ ] claim CAS 竞争失败不再继续执行（现状：控制面 `DataApiInternalController` 丢弃 claim 布尔仍返 200；客户端竞争失败仍得 200）
  - [ ] claim 抛异常不再继续执行（现状：`exports.py` 异常分支硬编码 `claimed = True` 注释「仍尝试执行」）
  - [ ] 服务缺失分支进入正确终态（现状：`_finalize_failure` 少传 `status_code` 参数致 TypeError，任务卡 RUNNING，仅进程重启兜底）
  - [ ] 审计回写检查 HTTP 4xx/5xx 失败并进入持久缓冲（现状：`_post_call` 只捕传输层异常，HTTP 状态失败视为成功）
  - [ ] 重启恢复与重复 worker 场景有明确终态
- [ ] G21-3 Data API 服务更新与 Key 权限：
  - [ ] 部分更新未传 `parameters` 沿用持久化参数（**现状已满足**：`DataApiAdminService.java:114` 已沿用，只需补回归测试锁定）
  - [ ] API Key 签发/吊销收紧为平台/租户管理员；数据工程师保留服务定义编辑（现状：`OidcSecurityConfiguration.java:121` 三角色均可，控制器注释宣称收紧但代码未实现）
- [ ] G21-4 AI Data 构建清单真实性：
  - [ ] `containsPhi` 由实际 Recipe 执行步骤与扫描结果完整推导（现状：仅由 deidentification 命中累加，只跑 pii_detection 不跑脱敏时恒 False）
  - [ ] `deidentified` 不再硬编码 True，由 pipeline 实际配置推导（现状：`rag_builder.py:423` 静态 True）
  - [ ] 评估读取指定产品版本的 Manifest 参与事实计算：不同产品 Manifest 得到不同评估事实（现状：product/version 仅作报告标签，`engine.py` 不读 Manifest）
- [ ] G21-5 开发环境分析看板 503（Superset 路由 404）修复：列表与一个嵌入页返回成功；失败路径仍显示真实不可用状态，不回假数据
- [ ] G21-6 `ProductScopeNotice`（及 `RuntimeStatusBanner` 的 SCOPE_SUMMARY 镜像）只声明已真实恢复的状态，不提前宣称 G22–G26 完成
- [ ] G21-7 本地六子工程与门户测试全绿（AGENTS.md 命令）；同一提交 GitHub Actions 全绿
- [ ] G21-8 `docs/validation/gate-g21-<date>.md` 收口 + 延期台账更新

## G22 数据标准中心真实化（依赖 G21；8–12 人日）

- [ ] G22-1 Flyway V17 五表（data_standard / data_standard_version / data_standard_element / data_standard_value / data_standard_event），纯加法迁移
- [ ] G22-2 计划固定的 12 个接口逐一按路径可用（data-standards CRUD + versions + submit/publish/deprecate + import + compare + impact + fhir-bundle）
- [ ] G22-3 状态机与不可变：DRAFT→IN_REVIEW→PUBLISHED→DEPRECATED；只有 DRAFT 可改；PUBLISHED 内容不可覆盖，只能新建版本
- [ ] G22-4 非法输入拒绝（各至少一用例）：同码重复、版本倒退、非法类型、空值域、越级发布、跨租户读取
- [ ] G22-5 权限三级：平台/租户管理员发布；数据工程师起草/提交；普通治理用户只读；越权拒绝且审计存在
- [ ] G22-6 导入：平台 CSV 模板 + 内部 JSON Schema，先 dry-run 预检后落库
- [ ] G22-7 OM 同步：发布后向 OpenMetadata 同步术语引用；OM 不可用时标准本地仍可读，状态 `SYNC_PENDING` 并允许人工重试，不伪造成功
- [ ] G22-8 FHIR R4 导出（CodeSystem/ValueSet/ConceptMap）：导出校验稳定，且不含内部数据库标识
- [ ] G22-9 门户数据标准页接真实 API：列表、详情、版本对比、导入预检、评审、影响范围；真实模式不再读 `mock.ts`；空/错/加载态齐全，`qa/mock-audit` 相应收紧
- [ ] G22-10 compare / impact 返回真实版本差异与受影响资产引用
- [ ] G22-11 矩阵八项 + gate 文档

## G23 标准映射与治理工作台真实化（依赖 G22；10–15 人日）

- [ ] G23-1 Flyway V18 五表 + 控制面 `mapping` 模块，计划固定的 10 个接口逐一可用
- [ ] G23-2 版本不可变 + 带 checksum 的 Mapping Manifest；活动版本指针可回退到上一已发布版本，历史事件不删除
- [ ] G23-3 转换白名单 COPY / TRIM / UPPER / DATE_FORMAT / VALUE_MAP；任意 SQL、脚本、表达式被拒绝
- [ ] G23-4 质量执行器 `POST /api/v1/mapping-validations`：只读聚合（类型兼容性、空值率、值域覆盖率、未映射值 TOP N、数据时间）；拒绝未登记 dataset/列/转换；不返回原始行、患者标识或任意 SQL 结果
- [ ] G23-5 ACTIVE 前必须存在同一内容 checksum 的 PASS 验证证据；并发激活有明确结果（只有一方生效）
- [ ] G23-6 治理导航三入口接真实能力：血缘与影响→资产技术视图（带资产筛选）、问题闭环→质量问题工作台、数据合同→数据服务合同视图；不复制血缘/问题/合同状态机
- [ ] G23-7 AI Ready `fhir_mapping_coverage` 改为消费 ACTIVE Mapping Manifest 的真实覆盖率；未配置映射仍 N/A；探针失败必须 FAIL（**现状探针失败已是 FAIL**：`engine.py:119` 统一 FAIL 收口——换数据源后保持该语义并加锁定用例）
- [ ] G23-8 全链演练（dev 真实链路证据）：`ods_ep.ep_mz_cfzb` 一版字段映射「导入 → 聚合验证 → 评审 → 生效 → 影响查看 → 回退」
- [ ] G23-9 异常面：源字段失效、标准版本停用、覆盖率不足、质量执行器不可用均有明确结果
- [ ] G23-10 矩阵八项 + gate 文档

## G24 管理驾驶舱与运营中心真实化（依赖 G21，可与 G22 并行；7–10 人日）

- [ ] G24-1 三个只读投影接口（`/api/v1/operations/summary`、`work-items`、`events`），不新建状态表；每项带 `sourceType/sourceId/asOf` 且深链可达真实工作台
- [ ] G24-2 投影覆盖面齐全：采集失败/停滞运行、治理问题 SLA、通知与合同投递积压、MPI 待复核、Data API 调用失败、AI Data 构建任务、资产/分析配置状态
- [ ] G24-3 管理驾驶舱移除 `managementMetrics`、`riskRanking` 静态事实，接真实投影；真实模式不再读 `mock.ts`
- [ ] G24-4 新增「运营中心」真实路由（跨域待办，面向治理负责人）；「平台运维」继续面向技术角色，两者不合并
- [ ] G24-5 系统总状态显示覆盖组件数（ready/total），不再以三个探针代表整个平台 READY（现状：`OperationalFactsRegistry` 仅聚合 3 事实）
- [ ] G24-6 下钻验收（dev 实测）：首页任一红色指标两次点击内到达责任对象
- [ ] G24-7 一致性与诚实降级：模拟 Superset 503、通知积压、MPI 候选、AI 构建失败时摘要与明细一致；API 不可用时不显示静态回退（局部 UNKNOWN）
- [ ] G24-8 分页、筛选、加载/空/错误态复用现有 hooks 与 Drawer 原语
- [ ] G24-9 矩阵八项 + gate 文档

## G25 交付中心与验收证据包（依赖 G24；8–12 人日）

- [ ] G25-1 Flyway V19 四表 + `delivery` 模块，计划固定的 10 个接口逐一可用；生命周期 DRAFT→IN_PROGRESS→READY_FOR_ACCEPTANCE→ACCEPTED→ARCHIVED
- [ ] G25-2 READY 前逐项检查：引用存在、状态可交付、质量/认证/合同证据可读取；失败项明确阻断，不自动跳过
- [ ] G25-3 快照与状态动作要求 `Idempotency-Key`；同一幂等键只生成一份快照
- [ ] G25-4 证据包内容白名单：manifest、版本、质量结论、认证/合同状态、运行摘要、事件清单、checksum；不含行级数据、SQL、Token、Secret、连接串或患者标识（下载后逐项复查）
- [ ] G25-5 门户「交付中心」一级路由闭环：项目、交付项、阻断项、证据快照、验收、下载
- [ ] G25-6 全链演练（dev 证据）：1 个 Dashboard + 1 个 Data Service + 1 个 SERVING AI Data Product 建项目、提交、验收
- [ ] G25-7 异常面：引用下线、质量未通过、重复验收、证据源 503、跨租户访问均正确处理
- [ ] G25-8 矩阵八项 + gate 文档

## G26 受控智能问数 Beta（依赖 G21，建议最后整体验收；8–12 人日）

- [ ] G26-1 Flyway V20 两表（`assistant_verified_question` / `assistant_query_audit`）；状态 DRAFT→PUBLISHED→DEPRECATED；审计不存结果行
- [ ] G26-2 三个真实数据服务就绪并经 Data API 发布：`prescription-daily-summary`（seed 已存在）、`prescription-department-daily` 与 `medicine-record-daily`（**现状不存在，需新建**）
- [ ] G26-3 Data API 新增 `/internal/v1/verified-queries/{serviceCode}/query`：复用现有 SQL 模板校验、机构范围、限额、熔断与调用审计，不复制查询执行器（注意：现有 `/internal` 端点全部在控制面 `/internal/data-api/**`，data-api 侧首个 internal 路由，认证方向相反，设计需对齐 internal-mode 语义）
- [ ] G26-4 服务间认证：独立 Keycloak client `dataos-assistant-bff`、audience `dataos-data-api`；`DATAOS_ASSISTANT_OIDC_*` 四项与 `DATA_API_RESOURCE_*` 三项配置就位；只有 client secret 为秘密（部署机 0600 文件），其余非秘密配置
- [ ] G26-5 控制面三接口（questions / query / feedback）：只做问题匹配、用户范围与回答编排
- [ ] G26-6 门户智能问数与专业工作区接真实接口：支持问题、参数范围、结果、服务版本、统计窗口、数据时间、查询证据；无法匹配、参数越界、无权限、下游不可用时明确拒答，**禁止回退演示答案**；演示模式保留样例且显式标记
- [ ] G26-7 精度验收：3 个问题与 Doris 人工 SQL / Data API 直接调用逐项零误差
- [ ] G26-8 拒答面：未知问题、越权机构、非法日期、超限、服务下线、Data API 503 均无 SQL 执行副作用；同义表达命中同一问题代码
- [ ] G26-9 反馈可追溯到具体审计记录
- [ ] G26-10 矩阵八项 + gate 文档

## 阶段总验收（全部 Gate 完成后）

- [ ] S-1 门户一级导航「运营中心」「交付中心」均有真实路由
- [ ] S-2 数据标准、标准映射、管理驾驶舱、智能问数真实模式不再读取 `mock.ts` / `integrations.ts`（含标准映射页内联静态数组）
- [ ] S-3 治理导航「血缘与影响」「问题闭环」「数据合同」进入现有真实能力，无无动作占位
- [ ] S-4 标准与映射具备版本、评审、发布/生效、停用、影响分析和审计，不只是 CRUD
- [ ] S-5 管理驾驶舱与运营中心每个指标可下钻到现有任务、问题、MPI 候选、数据服务或 AI Data 作业
- [ ] S-6 交付项目可绑定真实资产并生成不含 PHI、密钥、连接串的不可变验收证据快照
- [ ] S-7 智能问数至少 3 个可复核问题，未知问题明确拒答，不生成任意 SQL
- [ ] S-8 每个 Gate 有自动化测试、开发环境真实链路证据和独立回滚路径
- [ ] S-9 G21 后远端 CI 保持绿色；最终 Gate 完成后六子工程本地全量测试 + 门户全链全绿

## 附录 A：计划现状断言核对（2026-09-20，批准前尽调）

核对方式：四个只读探查代理分域核对代码 + `gh run view` 直接读取远端 CI 失败日志。结论分三级：属实 / 部分属实 / 不属实（并注明对验收清单的影响）。

### A.1 远端 CI（gh run 35256951768，对应 HEAD f3b5546，最近 8 次全红）

三个失败 job 的根因与计划 G21 诊断对照：

| 计划诊断 | 实测 | 结论 |
| --- | --- | --- |
| 控制面 3 个时序/隔离失败 | `ControlPlaneApiTest.submissionResultMustBeWrittenByCurrentLeaseOwner`、`DataServiceExportTest.exportLifecycleCreateClaimFinalizeExpire`、`DataApiAdminServiceTest.recordCallIsIdempotentAndFeedsUsageAndAudit`，Tests run: 217, Failures: 3 | 数量一致；「时序/隔离」性质待 G21 诊断确认 |
| quality-runner 漏装 httpx | `test_security.py` 收集失败 `ModuleNotFoundError: No module named 'httpx'`；`pyproject.toml` 已含 httpx==0.28.1，CI 安装列表缺项 | 属实（属 CI 安装步骤问题，非依赖声明问题） |
| 生产 Compose 校验缺失测试 secret | Validate DolphinScheduler overlays 步骤：`required variable DATAOS_AI_READY_OIDC_CLIENT_SECRET is missing a value` | 属实，secret 名已具体化 |

注：曾按静态读文件判断「CI 无 secret 缺失」，被 CI 日志直接证据推翻——以日志为准。

### A.2 门户（六项断言全部属实）

- 数据标准（`DataStandardsPage.tsx:7` ← `data/mock.ts`）、管理驾驶舱（`ManagementDashboardPage.tsx:6`）、智能问数（`AssistantPage.tsx:7` ← `data/integrations.ts:236` 演示剧本）取演示数据；标准映射页为**页面内联静态数组**（`StandardMappingPage.tsx:14-16`），性质相同但不在 mock.ts；四页真实模式显示「暂未接入真实数据服务」诚实拒绝（`DemoDataBoundary`）。
- 运营中心/交付中心：`AppShell.tsx:44-45` 无 route 的 NavItem，渲染为 `aria-disabled`「规划中」，点击无动作。
- `managementMetrics`（`mock.ts:3`）、`riskRanking`（`mock.ts:138`）静态事实被管理驾驶舱渲染。
- `ProductScopeNotice.tsx:8-16` 宣称口径与计划描述一致（数据标准/映射/问数/交付中心仍为规划中），另镜像于 `RuntimeStatusBanner.tsx:9` 常驻横幅——G21-6 两处都要收敛。
- 治理导航「血缘与影响/问题闭环/数据合同」三个 tab 无 `route`、无 onClick，角标「规划中」（`GovernanceTabs.tsx:9-11`）。
- 系统总状态：`OperationalFactsRegistry.java:43-45` 仅聚合计 3 个事实（qualityExecutor、seaTunnel、notification）；前端横幅不渲染 ready/total 组件覆盖数（API 结构已有该字段）。

### A.3 Data API

| 计划断言 | 核对 | 结论 |
| --- | --- | --- |
| claim 竞争失败仍继续 | 控制面 `DataApiInternalController.java:118-129` 丢弃 CAS 布尔仍返 200；客户端恒得成功 | 属实，需修 |
| claim 异常仍继续 | `exports.py:98-102` 异常分支硬编码 `claimed = True` | 属实，需修 |
| 服务缺失分支无正确终态 | `exports.py:103-105` 调 `_finalize_failure` 少传 `status_code` → TypeError → 卡 RUNNING | 属实，需修 |
| 审计回写不检查 HTTP 失败 | `controlplane.py:135-144` 只捕传输层异常，4xx/5xx 视为成功不入缓冲 | 属实，需修 |
| 部分更新未传 parameters 覆盖持久化参数 | `DataApiAdminService.java:114-115` 现状已沿用持久化参数 | **不属实（现状已满足）**→ G21-3 改为回归锁定 |
| API Key 签发/吊销仅管理员 | 现状 `OidcSecurityConfiguration.java:121-122` 三角色（含 data-engineer）均可；控制器注释宣称收紧但未实现 | 需收紧（差距确认） |
| verified-queries 端点不存在 | 全仓仅文档提及 | 属实 |
| 三个问数服务码存在 | 仅 `prescription-daily-summary` 有 seed（`deploy/scripts/data-api-seed.sh:28`）；另两个仅存在于计划文档 | 部分属实：两个需 G26 新建 |

补充：现有 `/internal` 端点全部属控制面（`/internal/data-api/**`，data-api 作为客户端调用）；G26 的新 internal 端点在 data-api 侧（控制面作为客户端），认证方向相反，是 data-api 首个 internal 资源路由。

### A.4 控制面与迁移

- Flyway 最高 V16（`V16__ai_data_build_job.sql`），V17–V20 空闲：属实。
- 无 standard/mapping/delivery/assistant 模块、无 `/api/v1/operations/*` 端点（唯一相近的是 `/api/v1/platform-operations`）：属实。

### A.5 AI Ready

| 计划断言 | 核对 | 结论 |
| --- | --- | --- |
| containsPhi/deidentified 来自实际执行与扫描 | `contains_phi` 由 deidentification 命中推导，但 pii_detection-only 场景恒 False；`deidentified` 硬编码 True（`rag_builder.py:423`） | 部分属实，需修 |
| 评估不读产品版本 Manifest | `engine.py:47,84-87` product/version 仅入报告元数据，事实只来自 catalog requirement + 探针；`api.py:40-42` 注释自认「当前评估不消费」 | 属实，需修 |
| fhir_mapping_coverage 探针失败须 FAIL | 现状：未配置→NOT_APPLICABLE（表缺失守卫）；探针异常→统一 FAIL（`engine.py:119-120`） | **现状已满足**→ G23-7 换数据源后保持并加锁定用例 |

### A.6 对计划的三处修正（已反映到清单）

1. G21「部分更新未传 parameters 沿用」现状已满足，改为补回归测试锁定（G21-3）。
2. G21「生产 Compose 校验缺失测试 secret」具体化为 `DATAOS_AI_READY_OIDC_CLIENT_SECRET`（G21-1c）。
3. G23「探针失败必须 FAIL」现状已满足，G23-7 为换数据源 + 语义锁定。
