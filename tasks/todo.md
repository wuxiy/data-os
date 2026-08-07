# 医疗数据平台方案规划

## 目标

形成一套可供小团队快速启动、同时支持单体医院与区域平台扩展的开源优先数据平台蓝图。首轮仅做需求与架构设计，不进入代码实现。

## 执行计划

- [x] 检查仓库基线、项目约束及历史教训文件
- [x] 调研 Databricks 可借鉴的架构原则与开源替代能力
- [x] 比较 SeaTunnel、NiFi/MiNiFi、Camel 的职责和取舍
- [x] 设计单院、区域、前置机三类部署与数据链路
- [x] 设计主索引、主数据、标准治理、质量与血缘能力
- [x] 设计技术人员与甲方业务人员的统一门户和关键页面
- [x] 明确首期边界、迭代路线、验收指标、风险和回滚策略
- [x] 交叉检查轻量运维、小团队交付及 10 倍规模扩展假设
- [x] 将数据治理提升为一级前端工作台，而非仅提供质量页面
- [x] 补齐治理驾驶舱、标准、映射、质量、血缘、问题闭环和数据合同页面
- [x] 校验治理页面对管理、治理、技术三类用户的任务闭环与原型范围
- [x] 核对 dbt、Doris、OpenMetadata 当前官方能力与集成边界
- [x] 比较 dbt 与质量、调度、目录、血缘、主数据模块的职责分工
- [x] 给出医疗平台治理底座推荐、最佳实践判断和分阶段落地方案
- [x] 锁定第一版原型的信息架构、视觉系统和设计验收标准
- [x] 生成并自审管理驾驶舱、治理驾驶舱、标准、映射、质量闭环、MPI 六个视觉概念
- [x] 搭建 React + Vite 可发布级原型并实现六个页面、责任链溯源与完整交互反馈
- [x] 验证构建、核心点击路径及 1280–1920px 桌面端布局
- [x] 对照概念稿完成视觉复核并记录第一版结果

## 结果复盘

已形成 `docs/medical-data-platform-blueprint.md` 评审稿。推荐以统一医疗门户为产品控制面，首期采用 SeaTunnel + Doris + S3 兼容对象证据层；前置机按 MiNiFi/OIE 场景选型，Camel 只作特殊协议 SDK；OpenMetadata、HAPI FHIR MDM、Superset 分别承接治理、医疗身份与分析能力。纯 Iceberg/Trino 湖仓保留为明确的替代路线和升级决策门。

完成了官方资料核对、组件边界检查、正常/故障/边界测试路径、依赖失败、10 倍规模和回滚成本审视。实现尚未开始，等待架构方向批准。

根据前端范围修正，数据治理已从单一“质量中心”提升为一级工作台，形成治理驾驶舱、标准、映射、质量、血缘与影响、问题闭环、数据合同与变更七个页面域。首轮高保真原型范围由 7 个关键页面扩展为 13 个，并分别定义管理、治理和技术用户的默认视图及下钻验收标准。

完成 dbt 技术决策：采用 dbt Core + dbt-doris 作为 L1—L4 批量/微批 SQL 转换和构建期质量门禁，不将其作为完整治理平台。OpenMetadata 负责资产、术语、血缘、合同和质量结果，平台治理注册库与 HAPI FHIR Terminology 负责医疗标准和值域，DolphinScheduler 负责调用，Doris 负责执行。新增 PoC 兼容性基线和不达标时的受控 Doris SQL 回退路径。

完成第一版可发布级桌面原型：React + Vite 实现管理驾驶舱、治理驾驶舱、数据标准、标准映射、质量闭环与主索引审核六页；责任链按 `issueId → assetId → ruleId → ownerId → ticketId` 展示事件、资产、规则、责任人与工单来源。根据反馈将高饱和绿色改为无渐变深灰松石与低饱和灰玉绿，并删除盾牌十字符号。

生产构建通过，1440×900 与 1280×800 桌面视口无页面整体横向溢出；标准选择、映射筛选/保存、质量复检、MPI 确认与责任链抽屉均完成浏览器实测。视觉对照与发布检查归档在 `prototype/qa/FIDELITY-LEDGER.md`。

## 2026-08-03 三类开源能力前端接入设计

### 目标

在不暴露组件拼盘的前提下，分别设计 Superset 嵌入式分析、OpenMetadata 数据资产/血缘和 DB-GPT 智能问数三个 data-os 业务页面，并保留专业人员进入原生控制台的降级入口。

### 执行计划

- [x] 复核现有设计系统、路由、导航和桌面端布局约束
- [x] 设计并实现嵌入式分析页：看板目录、业务结果、筛选和证据轨
- [x] 设计并实现数据资产页：资产检索、概览/血缘/质量和来源证据
- [x] 设计并实现智能问数页：会话、流式结果形态、SQL/资产证据和反馈
- [x] 接通三个新路由与主导航，补齐真实业务化演示数据和交互反馈
- [x] 更新原型说明，明确未来 BFF/API 替换点和原生控制台边界
- [x] 运行生产构建并检查 1440×900、1280×800 桌面视口
- [x] 复核键盘焦点、空状态、筛选、页面整体横向溢出和关键点击路径

### 结果复盘

完成数据资产、分析看板、智能问数三个独立工作台及主导航接入。三页统一使用“目录—业务工作区—证据轨”，分别承接 OpenMetadata、Superset、DB-GPT 的能力，但业务界面不暴露组件品牌和原生管理菜单；专业入口保留统一登录深链。生产构建通过，1440×900 与 1280×800 无页面整体横向溢出，资产质量页签、问数查询证据和目录切换完成浏览器实测，运行日志无错误或警告。

## 2026-08-03 技术架构文档与实施计划

### 目标

将已批准的平台蓝图收敛为可供架构评审、研发排期和项目验收的两份执行文档，明确控制面边界、组件集成契约、数据链路、部署拓扑、故障降级，以及 20 周 MVP 的工作包、里程碑、责任人和退出门槛。

### 执行计划

- [x] 复核既有蓝图、项目约束与 data-ops 复用结论
- [x] 核验 SeaTunnel、DolphinScheduler、Doris、OpenMetadata、Superset、DB-GPT 与 HAPI FHIR 的官方集成边界
- [x] 编写 `docs/technical-architecture.md`，冻结模块边界、接口模式、数据分层和部署拓扑
- [x] 编写 `docs/implementation-plan.md`，拆分阶段、工作包、人员、依赖、验收和回滚条件
- [x] 更新 README 文档地图与蓝图的详细设计入口
- [x] 检查术语、链接、里程碑、验收指标和架构决策一致性

### 结果复盘

完成两份实施基线文档。技术架构冻结为 React 门户 + Java 21/Spring Boot 3 模块化控制面 + PostgreSQL Outbox，所有开源组件通过稳定 Adapter/BFF 接入；Edge Node 明确为 Java 21 服务、SQLite WAL 状态库与文件 spool，避免为前置机引入 NiFi 服务端或额外消息中间件。Superset、OpenMetadata、DB-GPT、HAPI FHIR、SeaTunnel、DolphinScheduler、dbt 与 Doris 的事实归属、失败降级和替换边界均已落表。

实施计划按 5 人推荐团队拆成 20 周、7 个阶段门，W6 形成端到端 PoC，W20 完成首院 MVP；首院权限与协议样本、组件 BOM、MPI 标注集和 DB-GPT Beta 准入均设置了责任人和截止门槛。已通过 `git diff --check`、Markdown 代码围栏和本地链接检查；未修改或清理用户已有的 `prototype/.vite/` 等工作区内容。

## 2026-08-03 首条垂直切片实现与开发环境部署

### 目标

按 P1 垂直切片先交付可运行的“门户 → 控制面 → PostgreSQL”闭环：数据源登记、采集任务、运行记录、治理摘要和健康检查；不将尚未可用的执行器伪装成成功。

### 执行计划

- [x] 复核 data-ops 开发机服务、账号手册、`platform-net` 和可复用 PostgreSQL
- [x] 创建 Java 21 / Spring Boot 控制面模块，保留 `tenant_id`、`institution_id` 和 `data_os` schema 隔离
- [x] 实现数据源、采集任务、采集运行、治理摘要和 readiness API
- [x] 为运行 API 增加 SeaTunnel REST `POST /submit-job` 适配边界与 `BLOCKED_DEPENDENCY` / `BLOCKED_CONFIGURATION` / `SUBMIT_FAILED` 状态
- [x] 将治理驾驶舱和数据接入页接入控制面，控制面不可用时保留明确的演示降级
- [x] 增加不含密钥的开发 Compose、Nginx SPA 回退和 SeaTunnel 可选 profile
- [x] 本地运行后端 4 个 MockMvc 契约测试并通过 React/Vite 生产构建
- [x] 在开发机独立目录构建/启动控制面与门户，复用 PostgreSQL 并完成 API、静态资源和 schema 验收
- [x] SeaTunnel 二进制包校验、本地执行器镜像构建、REST 健康和首个真实作业提交
- [ ] DolphinScheduler、Doris/dbt、OpenMetadata/Superset/DB-GPT 的真实数据链路和 Edge Node（按 P1/P2 计划继续）

### 结果复盘

本地验证：`mvn -B -Dmaven.repo.local=/private/tmp/dataos-m2 test` 通过，4 个契约测试全绿；`npm run build` 通过（1606 modules）。Compose 通过 `docker compose config --no-interpolate` 校验，Nginx 提供 `/api/` 反向代理和 `/healthz`。

开发环境：隔离开发机的 `/root/data-os-dev-20260803`。新增服务为 `data-os-dev-control-plane-1` 与 `data-os-dev-portal-1`，门户实际端口 `18081`；控制面健康为 `UP`，PostgreSQL 中 `data_os` 已创建 `sources`、`ingestion_jobs`、`job_runs`、`governance_metrics`、`governance_issues` 五张表，验收时分别写入 2 个来源、2 个任务和 1 条阻塞运行记录。现有 data-ops 容器、Doris、Keycloak 和 `platform-net` 未被修改。

验收命令与结果：

```text
GET  /healthz                         -> {"status":"UP"}
GET  /api/v1/governance/summary       -> 6 metrics / 3 seeded issues
POST /api/v1/sources                  -> 201 PENDING
POST /api/v1/jobs                     -> 201 DRAFT
POST /api/v1/jobs/{id}/runs           -> 201 BLOCKED_DEPENDENCY
GET  /api/v1/jobs/{id}/runs           -> total=1
GET  /ingestion + static JS           -> 200
```

前端专用 Browser 在远程地址能读取页面标题，但其 DOM/控制台读取连续超时并触发大体积截图通知；因此本轮补充使用生产构建、HTTP 反向代理/资源检查和真实 API 验收，记录该浏览器路径为环境风险，而非应用错误。后续执行器上线时仍需补做 Browser/Playwright 的 1440×900 交互截图验收。

### 最终收口补充

- 控制面加入稳定的 `ExecutorAdapter` 端口和 SeaTunnel REST 超时边界；未配置执行器时明确返回 `中心采集执行器未配置`，不伪造成功运行。
- 数据接入页已提供数据源登记表单和采集运行反馈；门户 API 不再发送未由后端落库的幂等键，幂等/Outbox 仍列为 P1 后续工作。
- 修复 Nginx `/assets` 业务路由与 Vite 静态资源目录同名冲突；远程 `/`、`/ingestion`、`/governance`、`/assets`、`/analysis`、`/assistant` 均返回 200，控制面容器为 healthy。
- 重新构建并部署最终控制面镜像；本地 4 个后端测试、前端生产构建、Compose 配置检查、差异空白检查和敏感信息扫描均通过。共享 PostgreSQL `data_os` schema 验收为 2 个来源、2 个任务、2 条阻塞运行记录。

## 2026-08-03 SeaTunnel 重新部署与接入验收

### 目标

恢复可执行的中心采集执行器，将 SeaTunnel Zeta 通过内部 REST 地址接入 data-os 控制面，并验证一条真实提交链路。

### 结果复盘

- Docker Hub 镜像拉取在开发机前台会话中断，改用 Apache 官方 2.3.13 二进制包；部署 Dockerfile 在构建阶段下载并校验固定 SHA512，可从干净检出复现 `medical-platform/data-os-seatunnel:2.3.13-dev`，未修改 data-ops 原有 Compose。
- SeaTunnel 以单节点 `master_and_worker` 启动，REST `18082`、集群通信 `15801`，容器 healthy，`workers=1`；`ST_DOCKER_MEMBER_COUNT=1` 已生效。
- 控制面 `.env` 配置 `SEATUNNEL_BASE_URL=http://seatunnel-master:8080`。修正平台 `CDC` 到 SeaTunnel `STREAMING` 的模式映射；适配器对 400/401/403 等配置错误、408/429/5xx 暂时不可用做分层归类，并提供一次短退避重试。
- 直接 REST 烟囱任务完成 `FakeSource → Console` 提交与 `FINISHED` 验证；经 data-os `/api/v1/jobs/{id}/runs` 提交的任务返回 `201 SUBMITTED`、获得外部 `jobId`，SeaTunnel 状态验证为 `RUNNING` 后按验收要求停止为 `CANCELED`，释放执行资源。
- 控制面本地测试由 4 个增加到 6 个并全绿；SeaTunnel 容器与控制面最近日志无 `ERROR`、`Exception` 或启动失败。

本轮仍未实现 SeaTunnel 运行状态回写控制面（当前运行记录保持 `SUBMITTED`），由后续状态同步 Worker / Outbox 迭代承接；真实 HIS/EMR/LIS 连接器配置需在拿到院内只读账号和脱敏样本后单独验收。

## 2026-08-03 第二迭代：SeaTunnel 运行闭环

### 目标

把“控制面提交成功”推进为“控制面可查询并回写执行状态”的最小闭环，继续保持单节点、轻运维和可替换执行器边界。

### 执行计划

- [x] 扩展执行器适配器查询契约，冻结 `SUBMITTED/RUNNING/SUCCEEDED/FAILED/CANCELED/UNKNOWN` 归一状态
- [x] 增加 SeaTunnel `/job-info/{jobId}` 查询与官方/2.3.13 时间字段兼容解析
- [x] 增加运行记录更新仓储、定时同步 Worker 和按运行记录手动同步 API
- [x] 增加状态回写单元测试、MockMvc 契约测试和异常/未知作业测试
- [x] 在开发机提交一条短生命周期作业，验收 `SUBMITTED → SUCCEEDED/CANCELED` 回写
- [x] 更新门户运行反馈、部署说明和技术架构文档，完成双代理审查

### 结果复盘

- 本地控制面 Maven 全量测试通过：10 个测试全绿；前端 `npm run build` 通过；Compose 配置解析和 `git diff --check` 通过。
- 运行闭环现已包含：SeaTunnel REST 状态查询、固定 UTC 解析时区（仅 `startTime` 回填实际启动时间，`createTime` 不冒充 `started_at`）、404 归一为 `UNKNOWN` 并由门户人工重试、配置错误终止轮询、CAS 防旧状态覆盖终态、同作业活动运行行锁、`latestRunStatus` 派生投影、状态索引和门户手动同步。
- 开发机已完成可回滚重部署：控制面镜像按 `fe9bc7a` 重建，门户静态包、Compose 和运行配置已替换；远程保留 `rollback-pre-fe9bc7a` 备份目录，SeaTunnel 执行器未重建。
- 真实验收任务 `FakeSource → Console` 经 data-os API 返回 `201 SUBMITTED`，外部作业 `FINISHED`，16 行数据写入完成；控制面运行记录自动回写 `SUCCEEDED`，任务投影 `latestRunStatus=SUCCEEDED`，SeaTunnel 概览为 2 个 finished、0 个 running，三容器 healthy，最近 10 分钟无错误日志。

## 2026-08-04 第三迭代：采集任务可配置化

### 目标

把“任务可启动”推进为“任务配置可保存、可复用、可从门户创建和编辑”，让甲方人员不依赖一次性 API 请求即可重复运行一条已验收链路；本轮模板不保存真实密码，连接凭据继续以引用/后续能力包承接。

### 执行计划

- [x] 冻结任务配置持久化模型、模板边界和 API 错误口径
- [x] 增加任务配置仓储、配置状态投影及创建/读取/更新接口
- [x] 运行时默认使用已保存配置，补齐空配置和非法配置提示
- [x] 门户增加新建任务、配置编辑、模板选择和配置状态展示
- [x] 补齐后端契约/单元测试、前端生产构建和部署文档
- [x] 重新部署开发机，从门户/API 创建一条新任务并完成真实运行验收

## 结果复盘

本轮将采集任务从一次性运行推进为可交付的配置化闭环：新增 `ingestion_job_configs` 配置表、配置状态投影和 `GET/PUT /api/v1/jobs/{id}/config`；创建任务可直接保存模板配置，空运行请求默认复用已保存配置。运行接口增加按任务维度的 `Idempotency-Key` 重放保护和规范化请求指纹，配置不一致会明确返回冲突；配置递归拒绝明文密码、Secret、Token。运行提交进一步拆成短事务占位、事务外执行器调用和短事务 CAS 回写，避免长时间持有任务锁。

门户数据接入页新增新建任务表单、模板选择、JSON 配置编辑、未配置拦截、配置抽屉、运行详情抽屉和 5 秒自动刷新；前端生产构建通过。后端 MockMvc/适配器全量测试通过 14 项（含明文凭据拒绝、模板版本校验、幂等指纹冲突）；开发机已重新部署并完成真实 SeaTunnel 任务验收：空请求复用已保存配置、同 key 重放、不同配置 409、状态回写 `SUCCEEDED`、外部任务编号可查询，门户与三容器健康。

## 2026-08-04 第四迭代：交付可用性闭环

### 目标

在配置化和运行状态闭环之上，补齐业务人员每天实际需要的“启用/暂停/恢复、失败重试、数据源可用性检查”三条操作路径；所有状态均由控制面持久化，门户不使用本地假状态替代真实结果。

### 计划与测试接缝

- [x] 任务生命周期：`PUT /api/v1/jobs/{jobId}/status`，支持 `DRAFT/ACTIVE/PAUSED/ARCHIVED`，暂停和归档阻止新运行
- [x] 运行重试：`POST /api/v1/jobs/{jobId}/runs/{runId}/retry`，只允许终态运行，复用已保存配置并生成新的幂等键
- [x] 数据源检查：`POST /api/v1/sources/{sourceId}/check`，支持 JDBC、HTTP/FHIR，检查结果回写来源状态和最近检查信息
- [x] 先补 MockMvc/适配器公共接口测试，再逐条实现并运行单测
- [x] 门户接入启停/恢复/归档、失败重试、数据源 JSON 检查抽屉和结果反馈；控制面不可用时展示明确空态，不展示假运行状态
- [x] 更新部署说明、技术架构与验收命令，完成生产构建、远程验收和代码审查

### 结果复盘

本轮已完成交付可用性闭环：控制面新增任务生命周期、失败/阻塞/取消重试和 JDBC/HTTP/FHIR 数据源检查；门户新增启停/恢复/归档、重试、来源检查抽屉与结果反馈，控制面不可用时只呈现真实空态。后端 Maven 全量测试 21 项通过，前端 TypeScript/Vite 生产构建通过；代码审查发现的幂等重放顺序和假状态展示问题已修正。

远程开发环境 `/root/data-os-dev-20260803` 已创建回滚副本 `/root/rollback-pre-fourth-20260804`，仅重建控制面和门户，复用 PostgreSQL 与 SeaTunnel。验收结果：门户 `/healthz`、控制面来源/任务 API、SeaTunnel 2.3.13 概览均正常；HTTP 来源检查回写 `HEALTHY`；新增任务通过保存配置更新（FakeSource schema）和重试接口重新提交，SeaTunnel 外部运行 `1136821537278656513` 回写 `SUCCEEDED`，三容器均 running，成功后 90 秒控制面无新增错误日志。

剩余边界：真实 HIS/EMR/LIS 连接器、院内前置机 Agent、凭据/密钥托管与安全策略仍需拿到院内只读账号和脱敏样本后单独验收；本轮安全能力仍按原要求暂不展开。

## 2026-08-04 门户深链与配置默认展开缺陷修复
### 目标

修复数据资产技术视图、智能问数专业工作区无法打开，以及数据接入配置 JSON 默认不可见的问题，确保业务按钮都有可访问的真实目标。

### 执行计划

- [x] 建立门户交互契约回路，确认旧提交在深链、标签页和配置展开断言上失败
- [x] 新增 `/assets/technical` 技术视图路由与资产参数传递
- [x] 新增 `/assistant/workspace` 专业问数工作区路由与会话参数传递
- [x] 将两个入口改为真实新标签页链接，并保持导航激活状态
- [x] 让新建任务和任务配置抽屉中的采集配置 JSON 默认展开
- [x] 更新原型说明、教训记录，运行交互契约 smoke 与生产构建

### 结果复盘

旧提交 `aae681e` 运行 `node prototype/qa/portal-interactions-smoke.mjs aae681e` 按预期失败；当前版本运行 `node prototype/qa/portal-interactions-smoke.mjs` 通过。新增技术视图和专业问数深链均使用真实 `target="_blank"` 入口，配置 JSON 使用 `<details open>` 默认展开。前端 `npm run build` 通过（1607 modules）。系统 Chromium 包装器路径失效且 Playwright 浏览器下载受网络阻塞，本轮以源码契约回路和生产构建完成验证，后续开发机应补做真实浏览器截图验收。

## 2026-08-04 本地真实浏览器回归验收

### 目标

补做本地生产预览的真实浏览器验证，覆盖深链打开、页面渲染、配置 JSON 默认展开和浏览器控制台健康。

### 执行计划

- [x] 启动本地生产预览并确认可访问
- [x] 使用浏览器验证数据资产技术视图深链与页面内容
- [x] 使用浏览器验证智能问数专业工作区深链与页面内容
- [x] 使用浏览器验证数据接入配置 JSON 默认展开及页面无错误
- [x] 保存截图、DOM 和控制台证据，补充结果复盘

### 结果复盘

- 本地 `vite preview` 已在 `http://127.0.0.1:4173` 启动；本地浏览器以 1440×900 桌面视口验证技术视图和专业问数工作区，页面标题、深链参数、关键内容和控制台均正常。
- 资产页点击“打开技术视图”后真实打开 `/assets/technical?asset=asset-outpatient-visit` 新标签页；智能问数页点击“进入专业工作区”后真实打开 `/assistant/workspace?scenario=assistant-outpatient` 新标签页。
- 纯本地静态页的 `/ingestion` 正确展示“控制面暂不可用”真实空态；通过本地 `18081` SSH 转发访问开发环境真实 Portal/API 后，采集配置表单的 `details[open]` 数量为 1、配置文本框可见，打开已配置任务后抽屉内 `details[open]` 数量为 1、编辑器可见。
- 三个页面均无浏览器控制台 `error/warn`；截图证据保存在 `/private/tmp/data-os-browser-technical-view.jpg`、`/private/tmp/data-os-browser-professional-workspace.jpg` 和 `/private/tmp/data-os-browser-ingestion-config.jpg`。

## 2026-08-04 第五迭代：治理问题闭环真实化

### 目标

把质量闭环从前端演示数据推进为控制面持久化的真实工作流：可查询问题、查看责任/影响证据、提交处理说明、发起复检并看到状态回写；控制面不可用时明确空态，不展示假问题。

### 执行计划

- [x] 冻结治理问题查询、详情和状态/处理说明更新契约
- [x] 先补控制面 API 契约测试，再实现治理问题仓储与服务
- [x] 增加质量闭环页面真实 API 加载、处理说明保存和复检状态回写
- [x] 移除质量页不可验证的本地假状态，增加真实不可用/加载反馈
- [x] 运行后端单测、前端构建、浏览器交互回归并部署开发环境
- [x] 完成代码审查、提交并推送，补充结果复盘

### 结果复盘

本轮已将质量闭环从前端演示数据推进为可交付的控制面工作流：新增 `governance_issues` 扩展字段和 `governance_issue_events` 操作记录表，提供问题列表筛选、责任/影响详情、处理说明回写、复检请求和重复复检边界；门户从 PostgreSQL 读取真实队列，控制面不可用或详情读取失败时展示可见错误/空态，不再把假问题当作业务事实。复检本轮记录为 `RECHECKING + RECHECK_REQUESTED`，等待后续质量规则执行器异步回写实际结果，未将“请求已登记”冒充“规则已完成”。

验证证据：控制面 Maven 全量测试 23 项通过（治理 API 16、SeaTunnel 适配器 4、运行同步 1、来源检查 2，failures/errors 均为 0）；前端 `npm run build`、`node prototype/qa/portal-interactions-smoke.mjs` 和 `git diff --check` 通过。开发机 `/root/data-os-dev-20260803` 已创建 `rollback-pre-fifth-20260805-001336` 回滚副本，控制面镜像和门户静态包已部署，`/healthz` 返回 `UP`，真实治理问题接口返回 3 条记录，SeaTunnel 容器未重建且保持 running。桌面浏览器以 1440×900 视口访问 `http://127.0.0.1:18081/governance/quality`（SSH 转发至开发机）验证真实问题队列、LIS 搜索、责任链详情和责任人提醒边界，控制台 error/warn 为空；截图：`/private/tmp/data-os-browser-quality-final-1440.png`。

剩余边界：质量规则执行器、责任人通知通道和权限审计仍未接入；当前“开始复检”只登记请求并回写状态，下一轮需接入 dbt/质量规则运行记录、结果证据和自动关闭/退回策略。

## 2026-08-05 第六迭代：质量复检执行与通知闭环

### 目标

把复检从“控制面登记请求”推进为可观察、可回写、可自动流转的质量工作流：请求进入质量规则执行器，执行批次、通过/失败、样本证据可追溯；规则结果驱动自动关闭或退回，SLA 扫描产生逾期事件；责任人能够通过统一通知适配器收到可重试的提醒。

### 计划与测试接缝

- [x] 冻结质量规则执行器、执行批次、样本证据、通知适配器和 SLA 扫描 API/事件契约
- [x] 先补 MockMvc/适配器契约测试：复检投递、执行器状态轮询、结果回写、关闭/退回、SLA 逾期、通知 claim/重试和 HTTP/DBT 映射
- [x] 实现可替换质量规则执行器适配器（HTTP/dbt 运行契约）与异步轮询 Worker
- [x] 扩展治理问题模型：执行批次、结果、样本证据、自动流转策略和事件记录
- [x] 增加责任人通知通道（Webhook 优先，失败重试与幂等记录），门户展示投递状态
- [x] 开发环境部署质量执行器测试适配器，完成真实复检成功/失败、自动关闭/退回、SLA 逾期和通知验收
- [x] 完成前端交互回归、全量测试、代码审查、部署回滚记录并推送

### 结果复盘

本轮把复检从“登记请求”推进为可观察执行闭环：新增 `quality_rule_runs` 和 `governance_notifications` 持久化模型，复检先创建执行批次再投递 `QualityRuleExecutor`；开发档位提供确定性的 `DEMO` 适配器，生产可切换到共用 HTTP 契约的 dbt/院内规则执行器。后台轮询状态并回写 `passed`、`executionBatchId`、`sampleEvidence` 和执行时间；通过自动生成 `AUTO_CLOSED`，失败/取消/未通过自动生成 `AUTO_RETURNED` 或 `RECHECK_FAILED`，重复同步不会重复流转。

SLA worker 扫描到期问题并写入 `sla_overdue_at`、`SLA_OVERDUE` 事件；复检中的问题保留 `RECHECKING`，避免覆盖执行态。`SUBMITTING` 批次纳入恢复扫描，暂时不可用时保留中间态并退避重试；`RECHECKING` 期间禁止工作流覆盖。责任人通知使用 `WEBHOOK` 通道、幂等键、数据库租约 claim、指数退避和最大尝试次数；开发环境未配置 URL 时明确记录 `SKIPPED`，门户提醒责任人也复用同一队列。门户展示执行器、执行批次、结果、最近错误、样本证据、事件和通知状态，并支持“同步复检结果”。

验证证据：控制面 Maven 全量测试 34 项通过（治理 API 26、HTTP/DBT 质量执行器 1、SeaTunnel 4、运行同步 1、来源检查 2，failures/errors 均为 0）；门户 `npm run build` 和交互 smoke 通过。开发机 `/root/data-os-dev-20260803` 创建回滚副本 `rollback-pre-sixth-20260805-0935`、`rollback-pre-hardening-20260805-1015` 和最终部署前的 `rollback-pre-final-hardening-20260805-1047`，控制面镜像 digest 为 `sha256:700889c883ad38c87ce21f9ec568566fa74db207c0b4d804cebe12493a89f254`；仅重建控制面与门户，SeaTunnel 容器 `a91cb39a12622dba4c792e305b68b0926dfb93331f70acf4a015fefbda4172c8` 保持 `running/healthy` 且 `/overview` 正常。远程临时问题验证 `SUBMITTED → SUCCEEDED`、`passed=true/false`、样本证据 1 条、`AUTO_CLOSED/AUTO_RETURNED`、同一提醒幂等键只生成 1 条事件/通知、通知 `SKIPPED`，临时数据已清理。通过浏览器转发端口 `28082` 验证最终门户质量页真实连接和“提醒责任人”交互，控制台 error/warn 为空；最终截图和构建 hash、远程输出已归档至 `docs/validation/quality-hardening-20260805.md`。

本轮新增的生产边界：通知 URL 为空不会宣称送达；外部通道在 worker 崩溃后的极端窗口仍需依赖下游按 `idempotencyKey` 去重；`DEMO` 执行器仅用于开发验收，不得作为生产规则事实源；质量轮询在区域多副本部署仍需把进程内 `inFlight` 扩展为数据库租约/`SKIP LOCKED`。

## 2026-08-05 第七迭代：mock 核查与真实模式边界

### 目标

检查前端静态 mock、控制面 DEMO 执行器和 API 失败降级是否会误导交付使用，并将演示与真实模式做成可验证、可诊断的运行边界。

### 执行计划

- [x] 盘点所有 `mock.ts`、`integrations.ts`、fallback 和 DEMO 配置引用
- [x] 移除治理驾驶舱 API 失败时的本地问题 fallback，真实模式不展示静态责任链/趋势样例
- [x] 增加 `VITE_DATAOS_DEMO_MODE` 显式前端演示开关和静态页面边界组件
- [x] 增加 `/api/v1/system/status` 运行诊断接口，保护 DEMO 质量执行器并报告非敏感告警
- [x] 增加 mock audit、前端构建、后端契约测试和本地浏览器双模式验证
- [x] 重新构建本地生产/演示包，保留开发环境显式 DEMO 配置并完成远程可访问性复核
- [x] 完成代码审查并按审查结果补齐后端 FakeSource 防线、生产启动保护和 API 失败边界
- [x] 创建交付提交（`5cd77ee`）；推送当前分支待完成

### 结果复盘

前端 mock 已从隐式 fallback 改为显式模式：标准、映射、MPI、资产、分析、问数和管理驾驶舱在真实模式不渲染静态样例，显示待接入真实服务和已落地工作区入口；`VITE_DATAOS_DEMO_MODE=true` 才启用脱敏原型数据并显示“演示模式”。治理驾驶舱保留真实控制面摘要，API 失败时不再显示问题、责任链和趋势 mock。控制面新增运行状态接口，`DEMO` 质量执行器必须设置 `DATAOS_QUALITY_DEMO_ENABLED=true` 才会生效。

阶段验证：`npm run qa:mock` 通过，前端构建通过；后端新增运行状态与 DEMO 保护测试，Maven 全量测试通过；本地浏览器已验证真实模式静态模块阻断、治理 mock 清除和显式演示模式样例可见，控制台无应用 error/warn。远程部署、代码审查和源码同步已在本节补充复盘中完成。

补充复盘：代码审查发现并已修复三处落地风险——治理静态链路现在同时要求演示模式和控制面可用；真实模式新建/保存任务默认 `CUSTOM_JSON`，FakeSource 在前端和控制面生产路径均被阻断，历史 FakeSource 任务也不能启动；控制面新增 `RuntimeConfigurationValidator`，生产环境默认 fail-closed 并拒绝演示种子/DEMO 执行器。最终本地验证为前端 mock audit、交互 smoke、生产构建通过，控制面 Maven 全量 42 项通过（failures/errors/skipped 均为 0），`git diff --check` 通过；交付提交为 `5cd77ee`。远程开发机既有隧道可浏览器访问，但新 SSH 连接因凭据认证失败，未覆盖本轮最新静态包；此前已部署的开发环境基线未做破坏性操作，待恢复 SSH 凭据后按回滚副本流程重建门户和控制面。

### 2026-08-05 远程开发部署补充复盘

- SSH 认证恢复后，在 `/root/data-os-dev-20260803` 创建回滚副本 `rollback-pre-mock-20260805`，只重建控制面与门户，复用 PostgreSQL 和 SeaTunnel。
- 远程门户入口校验和与本地演示包一致：`f8db9f61faa7ada23ff5c866f8717dbc3b8803c2d624acc197a431cca62e2c3b`；控制面 JAR 校验和为 `b16e37da010d623e88000061c4d4777fc94ae1a6f70db77d2e8a69d7351899f4`。
- `/healthz` 与 readiness 均为 `UP`；`/api/v1/system/status` 明确返回开发 `DEMO` 模式、SeaTunnel 已配置、通知 Webhook 未配置告警；SeaTunnel 2.3.13 `/overview` 正常且容器未重建。
- 真实浏览器验收通过：首页演示边界可见；治理驾驶舱显示 PostgreSQL 指标与 3 条问题；数据资产可进入技术视图；智能问数可进入专业工作区；数据接入的采集配置 JSON 默认展开并可编辑。未提交表单或修改远程业务数据。
- 当前开发环境的 `FakeSource → Console（演示）` 和 DEMO 质量执行器是显式验收配置；交付生产仍必须使用真实采集配置/规则执行器，并由后端生产策略拒绝 FakeSource、演示种子和 DEMO 执行器。

## 2026-08-06 第八迭代：发布级产品全面审查

### 目标

全面审查当前产品成熟度，区分真实能力、演示能力和规划能力，形成生产发布阻断项、试点前必补功能、后续增强项及分阶段实施计划。

### 执行计划

- [x] 冻结发布口径、审查维度和 P0/P1/P2 分级标准
- [x] 盘点门户、控制面、数据模型、组件接入和部署运维现状
- [x] 执行测试、配置、依赖、运行环境和浏览器验证
- [x] 形成成熟度评分、问题证据、缺失功能和路线图
- [x] 完成交叉校验并归档正式审查报告

### 结果复盘

- 正式报告已归档至 `docs/release-readiness-audit-20260806.md`，区分演示 / 单院受限试点 / 单院生产 / 区域生产四种口径；当前生产成熟度工程估算为 34/100，不是合规认证结论。
- 当前可以作为 `0.2 Pilot Preview` 用于演示和受控联调，但不能标记为 1.0。P0 集中在身份与 RBAC、可信租户隔离、SSRF 与凭据服务、生产部署、版本化迁移与灾备、核心产品真实服务和真实端到端数据链。
- OpenMetadata、Superset、DB-GPT 等远程容器只算可复用基础设施，因 data-os 尚无身份、租户、审计和产品适配器接入，未计为已交付功能。
- 建议停止继续扩展静态页面，优先完成“身份/租户 → 凭据 → 前置机/真实数据源 → SeaTunnel → 目标库 → 真实质量 → OpenMetadata → 问题闭环 → 通知 → 监控证据”这一条可售最小闭环。
- 本次验证包括 42 项 Maven 测试、前端生产构建、mock audit、交互 smoke、npm 官方源 audit、远程环境只读检查和本地生产构建真实浏览器检查；`git diff --check` 通过。

## 2026-08-06 Gate 0：OIDC 安全收口与生产基础

### 目标

在已有 Keycloak/OIDC 的前提下，不引入 Sa-Token 第二套会话体系，完成 control-plane 的生产身份、租户、凭据、SSRF、迁移、部署、CI 和监控基线。

### 执行计划

- [x] 以 Spring Security Resource Server 接入 OIDC JWT，校验 issuer、audience、过期时间和 clock skew
- [x] 增加角色映射、租户/机构可信上下文、跨租户拒绝、401/403 Problem JSON 和审计事件
- [x] 增加 AES-GCM 凭据引用服务，API 不回显 secret，采集 JDBC 检查只接受 credentialRef
- [x] 增加默认拒绝的 HTTP/JDBC SSRF 策略、元数据/私网阻断、allowlist、重定向禁止和响应体上限
- [x] 引入 Flyway V1 基线迁移，关闭 `schema.sql` 自动初始化，并提供开发库 baseline 开关
- [x] 提供非 root 控制面、非特权 Nginx、独立 PostgreSQL、Prometheus 的生产 Compose 模板
- [x] 增加 Java 测试、前端构建、Compose/Prometheus 校验、Gitleaks 和镜像 SBOM CI
- [x] 完成全量回归、代码审查、配置静态校验和 Gate 0 复盘

### 结果复盘

生产默认保持 fail-closed：`DATAOS_AUTH_MODE=ENFORCED`、OIDC issuer/audience 必填、生产 issuer 必须 HTTPS；`DISABLED` 只在显式 development/test 配置使用。JWT 角色支持 `roles`、`groups`、Keycloak `realm_access` 和 `resource_access`，租户范围来自 `tenant_id`/`institution_id`，请求参数只能收窄不能替换。治理提醒入口也统一经过可信租户解析，跨租户请求返回 403；全局通知投递仅允许 platform-admin。

凭据以 AES-GCM 密文保存，密钥由 `DATAOS_CREDENTIAL_ENCRYPTION_KEY` 注入；凭据摘要和日志不含明文。来源检查默认只允许 HTTPS、白名单主机并阻断本机、私网、链路本地和云元数据地址；HTTP 重定向关闭，Content-Length 与 chunked body 均受 `maxResponseBytes` 限制。

验证结果：Maven 全量 `56` 项通过（failures/errors/skipped 均为 0），包含 OIDC MockMvc 实际 401/403、JWT claim 校验、跨租户、resource_access client 隔离、SSRF、chunked 响应上限和凭据不回显测试；前端已接入 OIDC PKCE 登录和 Bearer 注入，`npm run build`、`npm run qa:mock`、交互 smoke、`git diff --check` 和生产 Compose config 通过。CI 另外包含 npm audit、dependency review、Trivy 高危镜像扫描、生产 mock 边界和不可变 tag 检查。Prometheus promtool 与 Docker build 已写入 CI，但本机 OrbStack daemon 未启动，未能执行本地镜像构建/容器启动；CI 会在 Linux runner 上执行该门禁。

### 遗留边界

Gate 0 尚未覆盖 OIDC 多租户授权列表、CIDR allowlist/DNS rebinding 彻底消除、密钥轮换/Vault、PostgreSQL 备份恢复演练、SeaTunnel/质量执行器真实生产端到端链路和区域多副本数据库租约。这些列入 Gate 1/生产发布前清单，当前版本不能宣称完成医疗合规认证或区域生产 HA。

## 2026-08-07 Gate 1：DolphinScheduler 调度器落地与开发环境验证

### 目标

确认已批准的 DolphinScheduler 调度决策形成可交付的控制面适配器、单院轻量部署 overlay 和生产配置边界，并连接开发环境完成可重复的只读验证。

### 执行计划

- [x] 盘点现有执行器端口、运行状态回写和开发/生产 Compose 入口
- [x] 实现 DolphinScheduler 已发布工作流绑定适配器、认证回退、状态归一和外部运行编号
- [x] 将 data-os 持久化运行编号透传到 `startParams.dataos_run_id`，并明确提交响应丢失时不自动重试
- [x] 增加开发单院 JDBC Registry overlay、生产外置 PostgreSQL overlay、TLS 参数和幂等迁移脚本
- [x] 接入 CI 的 Compose overlay 校验；完成控制面制品重打包和 JAR 内容核验
- [x] 完成后端、前端、mock、Compose、远程 HTTP 只读验证并记录证据
- [x] 完成代码差异审查、已知边界归档和提交准备

### 结果复盘

已新增 `OrchestratorAdapter` 与 `DolphinSchedulerExecutorAdapter`。Gate 1 采用“预发布工作流绑定”而非每次动态创建 DAG：控制面调用当前 DolphinScheduler `/projects/{projectCode}/executors/start-workflow-instance`，把 `projectCode/workflowDefinitionCode` 和非敏感 `startParams` 作为任务配置，使用运行环境 token 或专用账号 `sessionId`，将返回实例编码为 `ds|project|workflow|instance`，再通过 `/workflow-instances/{id}`（旧版兼容 `/process-instances/{id}`）归一状态。

开发环境通过 `deploy/dev/dolphinscheduler/docker-compose.yml` 提供 API、Master、Worker、Alert、独立 PostgreSQL 和 JDBC Registry；生产环境通过 `deploy/production/dolphinscheduler-compose.yml` 接入外置调度数据库，并支持 `DOLPHINSCHEDULER_DB_SSLMODE`。Registry SQL 使用 `CREATE IF NOT EXISTS`，不会在容器重启时删除调度器元数据。CI 现在同时校验基础 Compose 和两个 DS overlay。

本地验证：控制面 `clean package` 通过，62 项测试全绿，最终 JAR 已包含新适配器；门户 build、mock audit、交互 smoke 和官方 npm audit 均通过；开发/生产 Compose `config --quiet` 均通过；`git diff --check` 通过。控制面 Docker 构建已触发，但 OrbStack 拉取基础镜像时 Docker Hub 认证请求超时，已记录为环境网络问题，CI 仍有镜像构建、Trivy 和 SBOM 门禁。完整证据归档于 `docs/validation/gate1-dolphinscheduler-20260807.md`。

远程开发机只读检查确认 `18081/healthz` 返回 `UP`、门户 `8443` 返回 `200`；现有远程实例仍是 DEMO/演示种子配置，`18083/19083/12345` 未监听 DolphinScheduler。SSH 端口可达但当前凭据被拒绝，未执行远程写入、部署或数据库变更，待可用密钥/凭据后补做真实工作流验收。

剩余 P1：DolphinScheduler 公开 API 无法按 `startParams.dataos_run_id` 做可靠唯一查询，提交响应超时只能安全地进入 `BLOCKED_DEPENDENCY` 并人工对账，当前不宣称 exactly-once；后续需建设跨系统对账表/适配器扩展。

## 2026-08-08 远程开发机部署 Gate 1 调度器

### 执行计划

- [x] 使用 SSH 公钥登录并盘点远程容器、网络、Compose 和回滚点
- [x] 备份远程开发部署目录的配置与当前控制面制品
- [x] 构建并切换新版非 root 控制面镜像，部署 DolphinScheduler 3.4.1 JDBC Registry overlay
- [x] 完成 Schema、API、Master、Worker、Alert、控制面和 Portal 健康检查
- [x] 创建开发专用 DolphinScheduler 服务账号/token，验证 token 权限边界
- [x] 创建并发布最小工作流，完成 data-os 任务提交、实例状态回写和相同幂等键重放

### 结果复盘

远程 SSH 公钥认证成功。部署前回滚快照为 `/root/data-os-dev-20260803/rollback-pre-dolphinscheduler-20260808-000348`；没有删除既有数据卷。调度器独立 PostgreSQL、幂等 Registry SQL 和官方主 Schema 均完成，四个运行服务均 healthy，控制面镜像使用 `user=dataos`，Portal 重新解析控制面后恢复 200。首次并发拉取 Docker Hub 镜像受远程加速器异常影响，改为逐镜像从可达镜像仓库导入，没有改守护进程配置或重启 Docker。

服务 token 已写入远程 `.env`（600 权限，未回显）；调度器 token 认证 API 返回 `code=0`。复检补齐 3.4.1 SHELL 任务插件，并将插件卷挂载到 API、Master、Worker；同时为开发单节点启用 default tenant bootstrap。隔离项目 `dataos_gate1_e2e_20260808` 与已发布工作流 `dataos_gate1_shell_20260808` 已通过 data-os 真实提交、DolphinScheduler 执行、Shell 日志和状态回写验收；相同幂等键重复提交返回同一 run/externalId，未创建重复实例。两条早期失败运行保留为插件缺失和租户配置缺失的故障证据。完整证据见 `docs/validation/gate1-remote-deploy-20260808.md`。

## 2026-08-08 Gate 1 调度器真实工作流复检

### 执行计划

- [x] 复现并定位 SHELL 工作流创建失败：确认官方 3.4.1 镜像缺少任务插件
- [x] 在开发/生产 overlay 增加固定 SHA-256 的任务插件安装器，并挂载给 API、Master、Worker
- [x] 补齐开发单节点 default tenant bootstrap 配置，完成服务重建与健康检查
- [x] 创建、发布隔离 DolphinScheduler 项目/工作流并通过 data-os 适配器触发
- [x] 核对 DolphinScheduler 实例、任务节点、Shell 日志与 data-os `SUCCEEDED` 回写
- [x] 用相同 Idempotency-Key 重复提交，确认只产生一个外部实例

### 结果复盘

第一次工作流触发到达 Master 后因 Master 未挂载 SHELL 插件失败；第二次已加载插件但因 `default` 租户开关关闭失败。补齐 Master 插件卷和 `WORKER_TENANT_CONFIG_DEFAULT_TENANT_ENABLED=true` 后，第三次运行 `ds|180931789157120|180932865356288|3` 成功，Shell 日志输出 `DATAOS_GATE1_WORKFLOW_OK`；随后相同幂等键验证返回同一 run `e2a1af9c-c57a-462b-99a8-19f11b6aff7d` 和外部实例 `...|4`，最终均回写 `SUCCEEDED`。生产仍需关闭 default tenant 回退、配置命名租户，并把插件 URL/SHA 固定到院方镜像仓库或离线制品库。
