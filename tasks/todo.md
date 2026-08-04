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

开发环境：`172.16.65.59:/root/data-os-dev-20260803`。新增服务为 `data-os-dev-control-plane-1` 与 `data-os-dev-portal-1`，门户实际端口 `18081`；控制面健康为 `UP`，PostgreSQL 中 `data_os` 已创建 `sources`、`ingestion_jobs`、`job_runs`、`governance_metrics`、`governance_issues` 五张表，验收时分别写入 2 个来源、2 个任务和 1 条阻塞运行记录。现有 data-ops 容器、Doris、Keycloak 和 `platform-net` 未被修改。

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
