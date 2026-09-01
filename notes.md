# Notes: Mock 能力核查与可落地化

## 当前基线

- 控制面默认 `DATAOS_SEED_DEMO=false`、`DATAOS_QUALITY_EXECUTOR=HTTP`，开发环境曾使用 `DEMO` 质量执行器做确定性验收。
- `DemoDataInitializer` 只有在显式开启 `data-os.seed-demo` 且数据库为空时写入种子来源、指标和治理问题。
- 前端治理问题页、数据接入页已经真实 API 优先，控制面不可用时显示不可用空态。
- `prototype/src/data/mock.ts` 仍被管理驾驶舱、治理驾驶舱、标准、MPI、资产、分析和智能问数页面直接引用；其中治理驾驶舱还有 API 失败后的本地 fallback 问题列表。
- `PageHeader` 明确提示部分筛选仍为演示行为；智能问数页面显示演示响应；数据接入模板中的 FakeSource → Console 明确标注演示。

## 风险判断

1. API 失败后治理驾驶舱使用 fallback 问题列表，会让甲方误以为控制面仍然有真实数据，和已落地的“不可用时不展示假问题”规则不一致。
2. 管理驾驶舱和治理驾驶舱指标仍来自静态 mock，没有统一的 API 状态标识；交付演示容易与真实数据混淆。
3. 资产、标准、MPI、分析、问数页面尚未接入控制面，这是产品边界而不是 bug；需要显式显示“演示/只读原型”而不是暗示已连通真实组件。
4. `DEMO` 执行器如果被部署到生产环境，会让规则结果看起来可用但并未运行真实规则，必须有启动时阻断或强提示。

## 目标验收

- API 故障时：管理/治理页不再静默显示 fallback 问题；呈现可见的连接状态和重试操作。
- 显式 demo 模式时：静态页面可正常体验，并显示统一的“演示数据”标记。
- 真实模式时：页面能通过 `/api` 获取已实现的控制面数据，空库显示真实空态，不自动注入 mock。
- 生产配置使用 HTTP/dbt 质量执行器时，启动检查能阻止缺失 endpoint 或明确报告未配置；DEMO 仅允许开发配置。
- 测试覆盖 API 故障、demo 模式、真实空态、DEMO 执行器保护和前端构建/交互。

## 已完成改动

- 新增 `RuntimeController` 与 `GET /api/v1/system/status`，报告 LIVE/DEMO、质量执行器、SeaTunnel、通知 Webhook 的配置状态和非敏感告警。
- `DemoQualityRuleExecutor` 增加 `data-os.quality.demo-enabled` 开关，默认关闭；测试 profile 和开发 Compose 显式开启。
- 新增 `DemoDataBoundary`、`RuntimeStatusBanner`、`VITE_DATAOS_DEMO_MODE`，静态模块真实模式只显示待接入边界，演示模式显示统一标记。
- 治理驾驶舱移除本地问题 fallback，真实模式不渲染静态责任链和趋势样例。
- 新增 `prototype/qa/mock-audit.mjs` 和 `npm run qa:mock`，文档归档在 `docs/mock-production-readiness.md`。

## 浏览器证据

- 默认真实模式：`/` 显示管理驾驶舱待接入边界，`/assets` 显示资产目录待接入边界，`/governance` 不出现静态问题/责任链/趋势样例。
- `VITE_DATAOS_DEMO_MODE=true` 构建：`/assets` 显示“演示模式”和脱敏资产样例，`/governance` 保留演示责任链结构。
- 两种模式本地浏览器控制台均无应用 error/warn；Browser SDK 的 Statsig 网络超时为工具自身遥测噪声，不属于应用日志。
# 2026-08-06 发布级产品审查工作笔记

## 审查口径

- 目标分层：演示版、项目试点版、生产发布版。
- 维度：产品完整性、真实数据闭环、架构与性能、可靠性与运维、安全与医疗合规、测试与质量、UI/交付体验。
- 严格区分：源码已实现、开发环境已运行、外部组件仅规划、静态演示数据。
- 问题分级：P0 阻断生产发布；P1 试点前必须补齐；P2 后续增强。

## 初始事实

- 已知真实能力：SeaTunnel 任务提交/状态同步、来源登记与检查、治理问题持久化、复检批次和结果回写、SLA 逾期、通知队列、开发运行状态诊断。
- 已知显式演示能力：管理驾驶舱、标准/MPI/资产/分析/问数部分页面、FakeSource、DEMO 质量执行器、开发种子数据。
- 已知外部边界：通知 Webhook 未配置；真实 HIS/EMR/LIS 连接、前置机 Agent、生产质量运行器与院内凭据尚未验收。

## 代码与功能盘点

### 已真实落地

- 控制面有 22 个 HTTP 入口，覆盖来源登记/检查、任务配置/生命周期、SeaTunnel 提交与状态同步、治理摘要、问题工作流、复检批次、SLA 扫描和通知队列。
- 采集配置禁止明文 `password/secret/token` 键，生产环境阻断 FakeSource/DEMO；运行使用幂等键和数据库状态条件更新。
- 质量复检提交、状态轮询、自动关闭/退回、样本证据、通知租约和幂等已有持久化与测试。

### 仅原型或未接入

- 管理驾驶舱、数据标准、标准映射、MPI、资产/技术视图、分析、智能问数共 8 个页面在生产构建中只显示“待接入真实服务”。
- 数据服务、运营中心、交付中心、系统设置没有路由；治理的血缘与影响、问题闭环、数据合同页签仍走 unavailable 提示。
- OpenMetadata、Superset、DB-GPT、HAPI FHIR MDM、Doris、DolphinScheduler、对象存储、Edge/前置机 Agent 在 data-os 源码和部署包中均没有产品 Adapter/服务实现。
- 机构/主题域/时间筛选器只弹提示，不改变 API 查询或页面结果。

## P0 级技术风险证据

- `pom.xml` 没有 Spring Security/OAuth2 依赖，所有业务 API、SLA 扫描和通知投递入口均无认证授权；远程匿名 GET 已直接读到治理摘要和责任信息。
- 租户与机构来自可篡改的 query/body，默认回落 `default/demo-hospital`；按 ID 查询、状态变更、来源检查和任务运行没有统一租户上下文，区域部署无法证明隔离。
- 来源检查允许请求方提交任意 HTTP/FHIR URL 或 JDBC URL，缺少目的地址 allowlist、内网/云元数据阻断和权限保护，形成 SSRF/任意网络探测面。
- 远程门户只提供 HTTP，响应未见 CSP/HSTS/X-Content-Type-Options/Frame-Options 等安全头。
- 数据库复用 Keycloak 数据库及账号，仅以 `data_os` schema 隔离；不符合组件故障域和最小权限生产要求。
- Docker 容器用户为空（默认 root）、根文件系统可写、没有 memory/CPU 限额；镜像使用可变 tag 而非 digest。

## 运维与发布缺口

- 仓库只有开发 Compose；没有生产 Compose/K3s/Helm、HA、副本、PDB、网络策略、TLS、资源配额和 Secret 管理制品。
- `schema.sql + spring.sql.init=always` 代替版本化迁移；没有 Flyway/Liquibase、迁移历史、回滚和生产升级门禁。
- 没有 `platformctl`、安装预检、备份/恢复、升级/回滚、诊断包、离线镜像包、组件 BOM/SBOM/许可证清单。
- 没有 CI 工作流；没有 SAST、依赖扫描、镜像扫描、secret scan、SBOM、签名和发布门禁。环境也未安装 gitleaks/trivy/syft/grype/hadolint。
- 没有结构化日志、业务审计表/拦截器、trace/correlation ID、Prometheus 业务指标、Grafana 告警规则、通知死信运营页。

## 测试证据

- 后端 Maven：42 项通过，0 failure/error/skip。
- 前端：生产构建通过；mock audit 通过（8 个静态页面受控）；交互契约 smoke 通过。
- npm 官方 registry audit：120 个依赖，0 个已知漏洞。
- 缺失：前端单元/组件测试、自动化浏览器 E2E、PostgreSQL Testcontainers、真实 SeaTunnel/质量运行器持续集成、性能/容量/长稳/故障注入/安全测试、迁移和备份恢复测试。

## 远程开发环境

- data-os 三容器已运行：portal/control-plane 约 19 小时，SeaTunnel 约 3 天且健康；运行模式为 DEMO，Webhook 未配置。
- 匿名治理摘要返回 6 个指标和 3 个问题，验证了认证缺失。
- OpenMetadata、Superset、DB-GPT、Keycloak 等容器虽存在，但不是 data-os Compose 服务，源码也无 Adapter；不能计入产品完成度。

## 审查收口

- 正式报告：`docs/release-readiness-audit-20260806.md`。
- 当前定位：演示 / PoC 基本可用，可命名为 `0.2 Pilot Preview`；单院生产成熟度工程估算 34/100，区域生产约 20/100。
- 发布优先级：先完成身份租户、凭据与网络安全、生产部署与迁移灾备，再完成真实采集/质量/资产端到端链；之后再扩展标准、MPI/MDM、数据服务、Superset 和 DB-GPT。
- 工期估算：4–6 人团队单院生产版约 14–21 周；范围受限的可售试点在 Gate 0 后约 6–8 周；区域能力额外约 10–16 周。

## 2026-08-06 Gate 0 实施收口

- 上述 P0 安全缺口已进入本轮实现：生产默认 OIDC 强制认证，JWT issuer/audience/时间校验、角色映射、可信租户上下文、跨租户 403、审计事件和统一 401/403 响应已落地。
- 凭据改为 AES-GCM 密文引用；来源检查改为默认拒绝的 HTTPS/allowlist 策略，并阻断私网、链路本地、元数据地址、重定向和超限响应体。
- 数据库启动改为 Flyway V1；生产 Compose、非 root 控制面、非特权门户、Prometheus 和 CI（测试、构建、Compose/Prometheus 校验、Gitleaks、镜像 SBOM）已补齐。
- 本轮并未把真实 HIS/EMR/LIS、前置机 Agent、OpenMetadata/Superset/DB-GPT 适配器或区域 HA 误标为已交付；这些仍按原审查结论进入 Gate 1/生产发布前路线。
- 复核后补齐：`resource_access` 只读取配置的 `DATAOS_OIDC_AUDIENCE` client 角色；门户使用 Authorization Code + PKCE 完成 OIDC 登录并为同源 API 注入 Bearer token；生产模板增加一次性旧库 Flyway baseline 步骤；CI 增加 npm audit、dependency review、Trivy 高危镜像扫描和 portal/mock 门禁。

# 2026-08-09 真实质量与凭据轮换实施笔记

## 实施前已确认事实（后续结果见下方）

- 远程 `172.16.65.59` 当前运行 control-plane、SeaTunnel、DolphinScheduler 和 portal；当前 control-plane 状态仍为 `DEMO`，通知端点未配置。
- 远程 `172.16.65.59` 可达 `172.16.66.8:8030/9030`；远程没有本地 Doris 容器，因此开发验收复用 data-ops Doris。
- DolphinScheduler 当前 token 为长期有效期，现有 Java 适配器在启动时读取固定字符串，未实现热加载、双 token 交叠或轮换。
- 现有控制面已有质量批次、状态轮询、证据回写、SLA、通知租约和幂等模型，但没有可部署的真实 dbt runner；Webhook 没有 HMAC/回执协议。

## 目标实现接缝

- 控制面质量适配器保持 HTTP 契约，新增 runner 的 OIDC Client Credentials headers 和受控 ruleId payload。
- 控制面通知适配器保持 `NotificationChannel`，替换为 HMAC signed webhook，并保留重试/幂等/租约。
- DolphinScheduler 适配器改为 Secret 文件 provider，可热加载 current/previous；生产删除用户名/密码登录回退。
- 新增 `services/quality-runner` Python 服务及 `deploy/dev/quality-runner` 配置；新增长期 Secret 卷和 token rotator 独立卷，控制面只读。
- data-ops dbt 资产只选择性迁入 data-os，运行时不访问 data-ops Git 或在线包源。

## 2026-08-09 实施与远程验收结果

- 远程回滚快照：`/root/data-os-dev-20260809-rollback-quality`；新增制品暂存：`/root/data-os-quality-20260809`。没有删除既有数据卷或恢复 DolphinScheduler Shell 插件。
- 质量 Runtime 镜像已部署并健康运行，实际复用 Doris `172.16.66.8:9030` 的 `dataos_quality_acceptance` 合成库；通过规则和失败规则均完成 dbt 执行，失败回写一条脱敏证据，制品地址存在，审计库验收后无失败表残留。
- 控制面复检闭环已实测：`HTTP` 提交返回外部批次，后台轮询拿到 `SUCCEEDED/passed=true`，治理问题自动 `CLOSED`；失败规则直连实测为 `FAILED/passed=false`。中途发现 JDK h2c 与 Uvicorn 不兼容，固定质量执行器 HTTP/1.1 后重新构建并通过闭环复测。
- DolphinScheduler 轮换器通过真实 `/access-tokens` API 创建短 TTL Token，当前 token 可鉴权访问列表接口；控制面读取 Secret 文件 `0600`，不再使用用户名/密码登录回退。日志与记录均未输出 Token 值。
- HMAC 通知经开发接收器真实验收：`/notifications/deliver` 返回 `sent=1`，回执数量增长，幂等键不重复；生产仍需替换为院方 HTTPS 消息网关与 SecretProvider。
- 本地 `mvn -B -Dmaven.repo.local=/private/tmp/dataos-m2 test` 共 71 项通过；Python `compileall`、Compose 配置、差异空白检查通过。真实 LIS/EMR/手术端点、院方 OIDC/RustFS/消息网关凭据仍是生产交接前置条件。

## 交付边界

- 本轮只能在远程开发环境验证合成数据和真实协议；没有院方统一消息网关、临床 LIS/EMR/手术端点或生产凭据时，不声称真实临床/生产验收完成。
- 不恢复 DolphinScheduler Shell 插件，不把 dbt 任务塞入 Worker。

# 2026-08-12 产品级与轻量投入复审笔记

## 评价口径

- 本轮只看功能实现、真实数据闭环、失败恢复、部署复杂度、运维操作和验证证据。
- 安全、认证、权限、合规、隐私和漏洞风险明确排除，不用这些维度提高或降低本轮结论。
- “代码存在”不等于“跨组件可用”；“开发合成验收”不等于“真实临床接入”。

## 事实摘要

- 控制面已形成数据源登记/检查、任务配置、运行提交、状态同步、检查点、治理问题、质量复检、证据和通知的真实 API/持久化骨架。
- 门户真实可用范围主要是数据接入、治理指标/问题队列和质量闭环；治理责任链、趋势以及标准、映射、MPI、资产、分析、问数等模块仍是待接入或演示边界。
- 控制面 Maven 测试 80 项通过；质量运行器在临时干净环境执行 4 项 pytest 通过；前端 mock audit、交互 smoke、生产构建通过；生产和 overlays Compose 配置解析通过；LIS 回放源 HTTP smoke 通过。
- 这些验证仍未证明真实 PostgreSQL 迁移、真实 SeaTunnel/DolphinScheduler 执行、真实 Doris/dbt/RustFS 跨容器链路、容器重启恢复和整个平台备份恢复。

## 关键功能缺口

- 真实 LIS/EMR/手术端点、字段/水位、Doris 目标、院方通知网关尚未形成当前仓库可重复验收。
- 外部采集提交在“外部已成功、控制面尚未写回外部 ID”的崩溃窗口存在重复提交风险；当前幂等主要是控制面内部幂等。
- quality-runner stale 重排队没有执行 fencing，旧 dbt 子进程可能与新 worker 短暂重复执行。
- UNKNOWN 状态没有统一的最大持续时间和人工对账终态；artifact URI 能在 runner 生成，但未完整回到控制面质量详情。
- 生产部署依赖多个外部系统和人工初始化；架构文档规划的 `platformctl`、整个平台标准安装/恢复/诊断入口尚未实现。
- 生产文档提供 `pg_dump` 和应用镜像回滚说明，但没有平台级 `pg_restore` 演练、恢复后校验、RPO/RTO 或整个平台恢复记录。

## 最终判断

当前最准确的定位是“有真实控制面和质量闭环骨架的受控试点基线”。可以在平台工程师参与、范围收窄为采集 + 治理 + 质量的前提下继续试点；不能按完整医疗数据产品或业务人员可自行轻量投入的门户交付。

## 2026-08-12 按建议补齐后的事实

- 门户新增首期范围提示，并在未接入模块上明确“规划中/不可用”；演示页面的保存、确认、生成动作不再暗示已经写入真实业务系统。
- 采集运行新增 `data_os_run_id` 对账 seam、外部运行关联和人工确认不存在；质量运行新增 UNKNOWN 人工重查/确认不存在，质量详情回显 `artifactUri`。
- quality-runner 的租约更新、完成写回和制品路径绑定 `execution_generation`，旧执行代次无法继续 heartbeat/finish，失效制品会清理。
- 新增 `deploy/production/scripts/platformctl`，覆盖 preflight、install、status、smoke、backup、restore、restart；占位环境会失败，dry-run 无真实端点时仍返回可判断结果。
- 复验结果：control-plane Maven 85 项通过；quality-runner pytest 8 项通过；前端 build/mock/interaction smoke 通过；Compose 配置和脚本语法通过。

### 仍然不能宣称的内容

- 本轮没有伪造真实 LIS/EMR、Doris、院方通知网关或跨组件生产 E2E 证据；这些仍是外部联调和上线前置条件。
- `platformctl backup/restore` 已提供标准操作入口和恢复后迁移检查，但未在本机执行真实生产数据恢复演练；不等于 RPO/RTO 已被证明。

# 2026-09-01 下一阶段计划调研笔记

## 已批准方向

- Decision Intelligence 不按附件 V0.1 原样建设；Roadmap 候选名称为“可治理的医疗指标语义与决策消费”。
- 先做 R0 产品准入；通过后才做 R1 指标语义、R2 真实决策工作台、R3 受控 AI Analyst、R4 Healthcare Pack。
- T5（MPI 混合决策权与多源重标定）是已有明确下一 Gate 候选，新主线不应自动取代它。

## 核对清单（已完成）

- T5 的实际前置条件、可否与 R0 并行。
- R1 可复用的 dbt/Doris 模型、G4 Superset 数据集、G13 Data API 及 OM 映射接缝。
- 最小新文件/迁移/API/门户范围与涉及文件数。
- 每个 Gate 的机器证据、远端实测、回滚和停止条件。

## 接缝核对结论

- G14 已有冻结 2142 对评测集、V2 影子分数和 45 对 dev 候选证据；下一步可先做“V1 AUTO/硬冲突不变，V2 只分流 V1 REVIEW”的混合影子策略，不能在单源 EP 条件下宣称完成多源重标定。
- control-plane 现有 `analytics`、`dataservice`、`lineage`、`governance` 模块足以承载新接缝；指标发布应作为 control-plane 内的 `semantic` 深模块，不需要新微服务。
- G13 Data API 的定义事实仍为 SQL 模板，适合通过独立 `metric_consumer_binding` 增加语义版本投影，不应复制 Key、配额、机构范围与审计实现。
- Superset 继续拥有图表和 Dashboard；门户只消费已授权嵌入、指标元数据和证据入口，不开发可视化编辑器。
- OpenMetadata 当前 `glossaryTerms` 缺陷不能成为新增 Glossary 的理由；指标发布保存 GlossaryRef 与 PENDING 同步状态，P3 升级事项继续归延后台账。
- 管理驾驶舱仍由 `DemoDataBoundary` 包裹；R2 可复用嵌入分析，并将决策动作登记为带指标上下文的治理问题，从而复用既有问题事件、通知发件箱与复查生命周期。
- `quality/dbt` 属于质量执行器，不应承载业务语义模型；若 R0 通过，应建立独立的一次性 `semantic/dbt` 工程，复用 Doris 而不新增常驻执行器。

## 计划决策

- 推荐 G15A（MPI 混合策略影子）与 G15B（Decision R0）并行；G16/G17 由 R0 单向解锁。
- 下一阶段控制在 G15A/G15B/G16/G17，预计 6–8 周、43–62 人日；AI Analyst 和 Healthcare Pack 不进入本阶段实施。
- 最大风险不是技术，而是 10 个工作日内能否取得真实业务 Owner 与采用基线；失败即 No-Go，用现有 Superset 满足固定看板需求。
- 正式计划：`docs/decision-intelligence-next-stage-plan-20260901.md`。
