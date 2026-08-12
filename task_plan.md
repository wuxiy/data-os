# Task Plan: Gate 0 安全与生产基础落地

## Goal

基于 Keycloak/OIDC + Spring Security Resource Server 完成 control-plane 的身份认证、角色权限、可信租户上下文和审计基础，并同时交付凭据引用、SSRF 防护、Flyway 数据库迁移、生产部署模板、CI 和基础监控。目标是让生产默认拒绝，开发环境只能通过显式配置放行，不扩大到 Gate 1 的真实数据源/资产/MPI 功能。

## Scope and decisions

- OIDC 是唯一的生产身份源，控制面作为 OAuth 2.0 Resource Server 校验 Keycloak 签发的 JWT；不再引入第二套 Sa-Token 会话/Token 体系，避免双重鉴权和权限漂移。
- 认证只保护 `/api/**`；健康检查和 Prometheus 保留匿名只读，Swagger 不在本轮引入。
- 角色与租户声明来自 OIDC Token，控制面只保留当前主体的审计索引和业务范围数据；不把开发环境的 Keycloak 数据库继续当作生产业务库。
- 凭据仅保存引用和加密密文，应用日志和 API 响应不得返回明文；真实执行器解析接口先形成安全契约，暂不假装已接入 Vault。
- SSRF 采用默认拒绝的 `SourceNetworkPolicy`：仅允许 `https`/受控 HTTP、显式域名/IP allowlist、阻止 loopback/link-local/云元数据/私网，设置连接/响应限制。
- schema.sql 不再承担生产迁移；以 Flyway V1 基线迁移现有表，开发与测试均走迁移路径。
- 生产部署提供 hardened Compose、独立 PostgreSQL、Secret 文件模板、资源限制、安全响应头和 Prometheus scrape 配置；不在本轮远程环境执行破坏性迁移。

## Phases

- [x] Phase 1: 盘点现有控制面端点、数据访问和配置，冻结认证/租户/凭据/网络契约
- [x] Phase 2: 先补 OIDC JWT 校验、租户上下文、权限拦截、身份回显和审计契约测试
- [x] Phase 3: 实现凭据引用与 SSRF 策略，并迁移来源检查和任务路径
- [x] Phase 4: 引入 Flyway、生产配置、hardened Compose、Actuator/Prometheus 和 CI
- [x] Phase 5: 全量测试、配置安全检查、构建与差异审查，更新交付文档和复盘

## Verification checklist

- [x] 未登录访问业务 API 返回 401；登录后才可访问
- [x] 非授权角色访问管理/治理写接口返回 403
- [x] 租户参数不能跨越登录账号授权范围；缺省租户不再来自用户输入
- [x] 凭据 API 只返回 ref/metadata，日志、配置 JSON 和异常不含明文
- [x] SSRF 负向用例覆盖 loopback、私网、link-local、metadata、非白名单域名、重定向和超时
- [x] Flyway 空库初始化与升级迁移通过；`schema.sql` 不再自动执行
- [x] 生产配置拒绝 DEMO/FakeSource、空 token secret、共享数据库默认账号和不安全网络策略
- [x] hardened Compose 配置校验通过；容器非 root、资源限制、只读文件系统和安全头生效
- [x] CI workflow 包含测试、构建、secret 扫描、SBOM 和镜像构建门禁
- [x] `/actuator/health`、readiness、Prometheus 指标可用且不泄露敏感配置

## Current status

Gate 0 实现与验证完成。控制面全量 Maven 测试 56 项通过，前端生产构建、mock audit、交互 smoke、Compose 配置和空白检查通过；门户已接入 OIDC Authorization Code + PKCE，API 请求自动注入 Bearer token，Keycloak `resource_access` 角色限定为配置的 API client。本机 Docker daemon 未启动，因此 Docker build/promtool 仅由 CI workflow 执行。区域多租户授权列表、CIDR/DNS rebinding 完整防护、密钥轮换、灾备演练和真实生产端到端链路仍属于 Gate 1/发布前工作。

## Historical audit plan

基于本地源码、测试、部署配置、产品界面和远程开发环境证据，判断 data-os 当前所处成熟度，列出达到可交付试点与生产发布仍缺失的功能、风险和可执行路线图。

## Review Specification

- 审查对象：`prototype` 门户、`control-plane` 控制面、SeaTunnel 集成、治理/复检工作流、部署与运维文档、远程开发环境。
- 发布口径：区分“演示版”“项目试点版”“生产发布版”，避免把页面原型或开发 DEMO 运行器视为真实能力。
- 证据要求：每个阻断项必须有源码、配置、测试、运行状态或浏览器证据；不凭空推断已存在的外部组件能力。
- 分级规则：P0 阻断生产发布，P1 试点前必须补齐，P2 可在后续版本增强。

## Phases

- [x] Phase 1: 回顾历史教训并冻结审查范围、口径和验证清单
- [x] Phase 2: 盘点代码、页面、API、数据库迁移、部署拓扑和第三方组件接入状态
- [x] Phase 3: 运行测试、静态检查、依赖与配置审查，复核远程环境健康和真实/演示边界
- [x] Phase 4: 使用桌面浏览器抽查核心用户路径、异常反馈和未实现入口
- [x] Phase 5: 形成发布成熟度评分、P0/P1/P2 缺口、功能清单和分阶段实施计划
- [x] Phase 6: 交叉校验结论，归档审查报告与结果复盘

## Key Questions

1. 当前哪些能力是真实可执行、哪些只是静态原型或适配器占位？
2. 能否在单院和区域两种部署形态下安全、稳定、可恢复地运行？
3. 数据采集、资产、治理、主索引、主数据、服务、分析、问数和运营是否形成真实闭环？
4. 身份权限、审计、医疗数据合规、备份恢复、监控告警、升级回滚是否达到生产基线？
5. 现有自动化测试和验收证据能否证明发布质量，而不仅是构建成功？

## Decisions Made

- 安全在早期原型阶段曾被暂缓，但本次以“发布级产品”为目标，安全与医疗合规必须纳入阻断项。
- 不把 OpenMetadata、Superset、DB-GPT、Doris、DolphinScheduler 的规划或 data-ops 环境资产自动算作 data-os 已实现功能。
- 以桌面端 1280–1920px 为首期发布目标，不把移动端适配列为缺口。

## Errors Encountered

- 根目录 `RTK.md` 不存在，但 `AGENTS.md` 引用了该文件；本轮按现有 AGENTS 规则继续，并将缺失本身纳入仓库治理问题。
- 默认 npm 镜像 `registry.npmmirror.com` 不支持 audit API；改用官方 `registry.npmjs.org` 后审计成功，0 个已知漏洞。

## Status

**Complete** - 正式报告已归档至 `docs/release-readiness-audit-20260806.md`，证据路径、功能边界、验证结果和发布路线图已交叉校验。

## 2026-08-09 真实质量执行器、Token 轮换与通知落地

### Goal

将质量复检从 DEMO 切换为可部署的独立 dbt Runtime，接入现有 Doris，加入 DolphinScheduler 短周期 Token 轮换、OIDC 服务间鉴权和 HMAC 通知通道；本地验证通过后部署开发环境，并保留院方真实端点/凭据注入边界。

### Phases

- [x] Phase 1: 盘点现有控制面质量/通知/调度器适配器、迁移和 Compose，冻结改动接缝
- [x] Phase 2: 实现独立 dbt Runtime、规则注册、审计证据、OIDC 鉴权与容器制品
- [x] Phase 3: 实现调度器 Token rotator、控制面热加载/无密码回退与配置迁移
- [x] Phase 4: 实现 HMAC 通知通道与开发合规接收器，切换 DEMO 保护
- [x] Phase 5: 本地单测/契约/构建/离线校验与安全门禁
- [x] Phase 6: 远程留回滚点、导入部署、复用 Doris 隔离库并执行真实开发验收
- [x] Phase 7: 代码审查、发布报告、任务复盘和提交

### Decisions Made

- dbt Runtime 独立容器，Python 3.12 + FastAPI/Uvicorn + psycopg 3 + SQLAlchemy 2，队列表使用幂等启动 DDL（不另起 Alembic 服务）；不把 dbt 放入 DolphinScheduler Worker，不新增 Redis/Celery/Kafka。
- dbt 只执行镜像内注册的 `dbt test --select`；业务库只读，`dataos_quality_audit` 为唯一受控写入区；失败样本最多 20 条，脱敏证据 PostgreSQL 180 天，RustFS 制品 30 天。
- 运行任务使用 PostgreSQL 租约队列，全局并发 2、单租户并发 1、15 分钟超时、重启可恢复，禁止任意 SQL/CLI/Shell/运行时项目上传。
- 控制面到 Runtime 生产使用 Keycloak OIDC Client Credentials（5 分钟 Token、最小 scope），开发验收显式使用 DISABLED 仅验证网络/闭环协议；通知使用 HMAC-SHA256 Webhook，开发仅启用合规接收器。
- DolphinScheduler Token 由独立最小权限 rotator 每 24 小时轮换，TTL 7 天，新旧交叠 30 分钟；控制面只读 Secret，生产和开发均无用户名/密码登录回退。
- 开发复用 `172.16.66.8:8030/9030` Doris，新建 `dataos_quality_acceptance` 隔离库和最小权限服务账号，使用合成数据。

### Verification checklist

- [x] `DEMO` 质量执行器/通知和密码回退在生产配置 fail-closed
- [x] dbt pass/fail、自动关闭/退回、执行批次、脱敏样本、幂等、并发限制、取消、超时、重启恢复
- [x] Doris 业务库只读、质量审计写入和遗留失败表清理
- [x] OIDC issuer/audience/scope/tenant 校验与 Token 过期行为（本地单测；开发部署显式 DISABLED）
- [x] Token 创建、smoke、切换、旧 Token 撤销和 rotator 故障演练
- [x] HMAC 签名、回执、nonce 防重放、重试、脱敏和接收器故障演练
- [x] Maven/Python/前端测试，Docker/Compose/SBOM/secret scan，离线导入/回滚
- [x] 远程部署回滚点、容器健康、Doris 隔离库、真实 API 和浏览器闭环

### Errors Encountered

- 当前开发机没有本地 Doris 容器，但远程 `172.16.66.8:8030/9030` 可达；改为复用现有集群并隔离数据库。
- 当前控制面仍为 DEMO、通知 URL 未配置；先实现真实协议与开发合规接收器，生产院方端点仍为部署前置条件。

### Results

- 本地 `services/control-plane` Maven 全量测试 71 项通过；质量 Runtime 与轮换器、通知接收器 Python `compileall` 通过，Compose 配置和 `git diff --check` 通过。
- 远程 `/root/data-os-quality-20260809` 保留制品与 `/root/data-os-dev-20260809-rollback-quality` 回滚点；control-plane、quality-runner、notification-receiver、scheduler-token-rotator 均健康。
- 复用 Doris `172.16.66.8:9030` 的合成验收库完成 dbt 通过/失败两条闭环：通过结果自动关闭，失败结果回写脱敏样本证据和执行批次；`dataos_quality_audit` 验收后无遗留失败表。
- DolphinScheduler Token 轮换器已创建短周期 Token，当前 Token 可通过 `/access-tokens` 鉴权，Secret 文件为 `0600`；控制面无用户名/密码回退。HMAC 通知经开发接收器签名验收并回执，重复投递保持幂等。
- 控制面复检曾暴露 JDK h2c→Uvicorn 兼容问题，已固定质量 HTTP 客户端为 HTTP/1.1，并完成重建后的控制面 `HTTP → dbt → 回写 → 自动关闭` 闭环复测。

### Boundary

本轮只完成合成 Doris 和协议级开发验收；真实 LIS/EMR/手术端点、院方 OIDC 客户端、RustFS 生产端点、消息网关和脱敏样本仍需院方交接后在生产配置中注入，不能宣称真实临床数据已接入。

### Status

**Complete**：实现、远程部署、闭环验收、问题修复和复盘均完成；生产启用前仍需按 Boundary 清单替换开发凭据与端点。

## 2026-08-12 当前版本产品级轻量投入复审

### Goal

在不评价安全、合规和隐私风险的前提下，重新判断当前版本是否具备产品级功能闭环，以及是否适合轻量投入使用。重点区分真实实现、仅有协议/代码但未完成跨组件证明、静态演示和规划能力。

### Scope

- 审查 `prototype` 门户、`control-plane`、`quality-runner`、采集执行器适配、治理/质量闭环、Compose 交付和运行文档。
- 仅从功能可用性、真实数据闭环、失败恢复、部署复杂度、运维可操作性和验证证据判断。
- 不把安全、认证、合规、医疗隐私和漏洞扫描作为本轮结论依据。

### Phases

- [x] Phase 1: 回顾既有审查与任务教训，冻结本轮评价口径
- [x] Phase 2: 盘点门户路由、真实 API、状态机、质量运行器和部署依赖
- [x] Phase 3: 执行 Java、Python、前端、Compose、脚本和回放源验证
- [x] Phase 4: 抽查门户失败态、空态、真实/演示边界和用户路径
- [x] Phase 5: 形成产品级结论、功能分级、轻量投入门槛和最小补齐路线
- [x] Phase 6: 写入复审报告、notes 和任务结果复盘，并完成差异校验

### Verification checklist

- [x] 控制面 Maven 测试：80 项通过，0 failures/errors/skipped
- [x] quality-runner：独立临时环境执行 4 项 pytest，全部通过；compileall 通过
- [x] 前端：mock audit、portal interaction smoke、生产 build 通过
- [x] 开发回放源：healthz 与 LIS 数据合同 HTTP smoke 通过
- [x] 生产基础 Compose、DolphinScheduler/SeaTunnel overlays 配置解析通过
- [x] SeaTunnel 脚本 shell 语法检查通过，`git diff --check` 通过
- [x] 浏览器抽查首页、数据接入、治理驾驶舱、质量闭环和平台运维的不可用/空态
- [x] 交叉确认真实临床端点、完整业务模块、统一安装/恢复和跨组件 E2E 仍未闭环

### Validation notes

- 默认 Python 环境没有 pytest；改用工作区运行时创建 `/private/tmp/dataos-quality-venv` 并安装 CI 所需测试依赖后完成验证。
- 前端初次安装受本机 npm 缓存权限和残缺 `node_modules` 影响；改用隔离缓存完成干净安装与构建。
- 浏览器静态预览使用普通 Python HTTP server 时，直接深链依赖服务器回退到 `index.html`；仓库生产 Nginx 已有回退配置，但尚未纳入真实发布 smoke。
- 回放源首次断言误读响应字段，按实际合同使用 `data` 字段复验通过；不影响产品代码。

### Result

- **完整产品级：未达到。** 门户公开范围包含多个未接入真实服务的模块；真实临床端点和跨组件生产闭环也没有由仓库持续集成证明。
- **核心垂直试点：有条件达到。** 数据源/采集任务/运行状态/水位/治理问题/质量复检/通知具备真实代码和持久化闭环骨架，适合已有平台团队配合外部依赖进行受控技术试点。
- **轻量投入：未达到“一份 Compose 即可用”。** 生产依赖 Doris、RustFS/S3、通知端点、PostgreSQL、制品和可选调度器，初始化、验收、备份恢复和升级仍有较多人工步骤。

### Deliverables

- 正式复审报告：`docs/product-readiness-review-20260812.md`
- 原始事实与证据笔记：`notes.md` 的 2026-08-12 小节
- 任务结果复盘：`tasks/todo.md` 的 2026-08-12 小节

## 2026-08-12 按复审建议补齐实现

### Goal

在不虚构真实院端点的前提下，把复审中可以由仓库直接补齐的最小产品闭环落地：首期范围收敛提示、外部运行可恢复关联、quality-runner 执行 fencing、UNKNOWN 人工接管、质量制品地址回传，以及可重复的 preflight/status/smoke 验收入口与恢复演练脚本。

### Scope and seams

- 控制面运行恢复 seam：`RunService`/`RunRepository` 与 `ExecutorAdapter` 的提交关联和人工对账接口。
- 质量运行 seam：quality-runner `claim/heartbeat/finish/requeue` 的 execution generation 合同。
- 质量结果 seam：quality-runner → `HttpQualityRuleExecutor` → `QualityRuleRun` → 治理详情的 `artifactUri`。
- 运维交付 seam：`deploy/production/scripts/platformctl` 的 `preflight/status/smoke/backup/restore` 子命令；不接管真实外部凭据。
- 门户范围 seam：未接入模块显示清晰的规划/不可用状态，不伪造业务副作用。

### Phases

- [x] Phase 1: 读取规范、复盘教训、冻结范围和测试 seam
- [x] Phase 2: 以失败测试/契约测试驱动控制面运行恢复与 UNKNOWN 接管
- [x] Phase 3: 以失败测试驱动 quality-runner fencing 与 artifact URI 全链路回传
- [x] Phase 4: 实现 platformctl 和最小 PostgreSQL/服务恢复验收脚本
- [x] Phase 5: 收敛门户未接入模块文案/动作，补前端契约检查
- [x] Phase 6: 运行全量测试、构建、Compose/脚本 smoke，并完成代码复审和复盘

### Acceptance checklist

- [x] 外部提交超时/控制面重启后，可按稳定 `dataOsRunId` 查询并人工关联外部运行，不直接重复提交
- [x] 采集和质量 `UNKNOWN` 均能进入明确的人工接管状态，且有重查/确认入口
- [x] quality-runner 旧执行代次无法 heartbeat、finish 或写入制品
- [x] `artifactUri` 从 quality-runner 回写到控制面质量运行和门户详情
- [x] `platformctl preflight/status/smoke` 可在无真实院端点时报告缺口并返回可判断退出码
- [x] `platformctl backup/restore` 提供标准化 PostgreSQL 操作和恢复后迁移检查，不删除数据卷
- [x] 未接入门户模块不再让用户误以为保存/确认/生成已经产生真实业务副作用
- [x] Java、Python、前端、脚本、Compose 和差异检查全部通过

### Status

**Complete** - 仓库内可直接补齐的建议项已实现并通过验证；真实院端点和跨组件生产验收仍保持明确边界。

### Interim validation

- 主线首轮编译发现 `HttpQualityRuleExecutor` 的 404 UNKNOWN 分支未同步新增 `artifactUri` 构造参数；已修复，随后 `mvn -DskipTests compile` 通过。
- H2 测试不支持原有 `INTERVAL` 参数表达式；恢复逻辑改为由 Java 计算截止时间后绑定时间参数，Maven 全量测试通过。
- 初始前端 smoke 使用过时的静态文案断言；按新的产品范围提示更新契约检查后重新通过。
- `platformctl` 对 `.env.example` 的占位值会明确失败；`status/smoke` dry-run 和 Compose `config --quiet` 通过，证明脚本在无真实端点环境也有可判断退出码。

### Verification result

- Control-plane Maven：85 项通过，0 failure/error/skipped。
- quality-runner：独立临时环境 8 项 pytest 通过，`compileall` 通过。
- Portal：`npm run build`、`npm run qa:mock`、`node qa/portal-interactions-smoke.mjs` 通过。
- Delivery：`bash -n deploy/production/scripts/platformctl`、`platformctl status/smoke` dry-run、占位环境 `preflight` 预期失败、生产 Compose `config --quiet` 和 `git diff --check` 通过。
