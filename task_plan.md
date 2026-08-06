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
