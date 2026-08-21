# 领域词汇表（CONTEXT.md）

医数中枢（data-os）的领域词汇。架构评审与设计讨论以此为准：新概念先在此定名，再进代码；讨论中术语变得模糊时，当场修订此表。

## 外部运行（External Run）

控制面委托给**外部执行器**（SeaTunnel / DolphinScheduler / 质量规则执行器）的一次运行，及其 `SUBMITTING -> SUBMITTED -> RUNNING -> 终态` 的**提交、轮询、对账生命周期**。

- 采集运行与质量复检运行都是外部运行：两台曾经各自手写的状态机，由统一的外部运行生命周期模块（`controlplane/run/ExternalRunLifecycle`）拥有。
- 两侧行为差异是接口上的**显式声明**，不是隐性分叉。例如过期 `SUBMITTING` 的处置（`StaleSubmissionPolicy`）：
  - 采集侧转 `UNKNOWN` 走人工对账——外部写入（双重采集）不可重入，宁可疑；
  - 质量侧原地重投并退避——质量检查幂等（执行批次号即执行器主键），重投安全。
- 对账（reconciliation）：外部运行结果不确定（`UNKNOWN`）时，按运行编号向执行器求证或由人工确认缺席（`confirmAbsent`）的过程。

## 患者主索引（MPI）

跨源系统归一患者身份的独立域，由 `services/mpi-service` 独占持有（control-plane 不含 MPI 逻辑、不直连 MPI 数据；门户只经 nginx 调 MPI 服务）。方案见 `docs/mpi-g3-review-and-plan-20260819.md`。

- **源身份（Source Identity）**：单一来源系统中的一个患者登记（机构 + 源主键/卡号 + 标准化属性），自 Doris ods 层装载，按源键幂等去重。
- **黄金人（Golden Person）**：一组被判定为同一自然人的源身份的归一主体（`mpi_person`）；Merge/Split 改变其成员构成，全程留痕可逆。
- **候选对（Candidate Pair）**：候选召回阶段产出的待判定身份对，跨召回规则按 pair 去重。
- **候选召回（Blocking）**：用确定性键（机构+源主键、机构+卡号、姓名+性别）缩小候选集合的 SQL 阶段；只负责召回，判定交给规则层。
- **硬冲突（Hard Conflict）**：人工已判 NO_MATCH 或已 Split 的身份对再次成为候选时，规则层强制 NO_MATCH——人工否决高于任何规则与分数。
- **人工复核（Review）**：中间置信区间（如卡号复用）进入复核任务，由门户工作台确认同人/不同人/合并/拆分，决策全部落审计。

三态口径：AUTO_MATCH（自动并入黄金人）/ REVIEW（人工）/ NO_MATCH。错误合并的临床风险高于漏合并：弱标识（卡号/手机号/姓名）不得单独硬合并，年龄等漂移属性仅作展示证据、不进规则。

## 血缘锚点（Lineage Anchor）

资产与血缘的元数据由 OpenMetadata 单一持有，门户只读不直连：

- **资产（Asset）**：OM 摄取的结构元数据实体（`doris-dataos` 服务下的 Doris 表，全限定名四段 `服务.default.库.表`），覆盖 data-os 自有三库：电子处方 ODS（`ods_ep`）、质量验收库（`dataos_quality_acceptance`）、患者主索引库（`dataos_mpi`）；口径是「结构元数据已摄取」，不含数据采样。data-ops 遗留库与空审计库不纳入。
- **血缘（Lineage）**：OM 中的实体间产出边；方向口径为**上游=数据来源、下游=产出与消费**（Superset 摄取建立的「表→数据模型→仪表盘」属下游产出链）。
- **摄取（Ingestion）**：一次性容器执行的幂等工作流（结构元数据 + Superset 仪表盘），连接配置保存在 OM 服务实体内（**更新连接必须走 PATCH——PUT 会静默忽略 connection 字段**），脚本与模板零口令入 Git。Doris 侧用专用只读账号 `dataos_om_ro`（三库 SELECT + compute group USAGE；业务账号 `dataos_quality_ro`/`dataos_mpi` 与元数据可见性分层）。
- **血缘 BFF（Lineage BFF）**：control-plane 的只读适配层（`/api/v1/assets/**`、`/api/v1/lineage/**`）；未配置 `data-os.openmetadata.base-url` 时整链不装配、端点 503——门户据此显示「待接入」而非静态样例。
- **服务身份（Service Identity）**：BFF/摄取访问 OM 的专用 Keycloak client（`dataos-om-ingest`，claim=ingestion-bot）；令牌现用现签，secret 只存部署机 0600 文件。

## 嵌入式分析（Embedded Analytics）

分析看板的呈现与授权链：

- **访客令牌（Guest Token）**：控制面 BFF 以服务账号向 Superset 签发的浏览器侧短时效凭证（Viewer 角色、限白名单仪表盘、空 RLS）；管理员凭据不出 BFF。
- **嵌入通道（Embed Channel）**：门户 nginx 专用监听端口（默认 18084）全量代理 Superset——SDK 以该 origin 拼接 `/embedded/{uuid}` 与 Superset 顶层路由，避免与门户 `/api`、静态命名空间冲突；浏览器全程 HTTP，不受网关自签证书影响。
- **嵌入白名单（Embed Allowlist）**：仪表盘级 `allowed_domains` 经 Referer 校验（非门户来源 403）；控制面另有仪表盘 id 白名单（白名单外 404）。
- **分析资产**：仪表盘/图表由 Superset 持有并同步进 OpenMetadata（`superset-dataos` 服务），口径与源表经「数据资产 · 血缘」追溯。

## 通知发件箱（Notification Outbox）

治理问题的事件通知先落 `governance_notifications` 表（发件箱），以幂等键去重入队；`NotificationOutboxRepository` 以数据库租约抢占外发（同租约防并发重复外发），外发通道（Webhook 等）与重试/放弃策略由通知模块持有。终态回写与租约释放同事务。

## 质量引擎（Rule Engine）

以特定技术执行一条质量规则的引擎。质量执行器（quality-runner）按规则把运行路由给引擎：引擎负责命令构造、结果解析、失败样本读取与自身产物清理（dbt 引擎即 `DbtEngine`）；进程监督（超时击杀、取消终止、心跳续租）与执行代次围栏由执行器共享的监督器承担。第二个引擎（Great Expectations、医院自有质检服务等）到来时实现同一接口即可接入。

## 运行模式（Runtime Mode）

门户的演示/真实呈现差异由运行模式模块（`prototype/src/data/runtimeMode.ts`）单一持有：构建期演示开关（`VITE_DATAOS_DEMO_MODE`）与后端报告的 DEMO 模式在此合一；静态样例可见性、演示（FakeSource）模板目录与守卫、快照文案全部由它派生，页面消费语义谓词而不散布布尔分支。生产路由表独立于演示数据（`data/routes.ts`）。

## 前置机边缘链路（Hospital Edge Relay）

院内隔离网段的数据经前置机（MiNiFi）采集后投递中心的对象中转桶，再由中心任务（SeaTunnel S3File 源）入仓到边缘增量表（Doris UNIQUE KEY(ID)，重放/重复投递天然幂等）。位点（增量游标）持久化在前置机本地（断电/重启不重不漏）；断网期间数据驻留前置机 FlowFile/content 仓库，恢复后自动补传。控制面以 `EP_EDGE_S3_TO_DORIS` 模板登记此类任务；中转桶凭据经凭据服务注入，落库配置只含 credentialRef。DELETE 不在增量链语义内——源侧删除需以数据修复动作双侧执行并留证。
