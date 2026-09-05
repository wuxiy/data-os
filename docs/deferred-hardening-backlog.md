# 下一阶段备忘（深度测试 / 安全 / 生产加固）

> **性质**：当前阶段（线上内测与功能快速迭代）主动延后的系统性工作，见
> [AGENTS.md](../AGENTS.md)「项目阶段与工作重心」。本清单是唯一台账——工作中
> 认为必要的深度测试、安全扫描、网络安全、生产加固事项记到这里，不排入
> 当前迭代（用户明示除外）。
>
> **维护纪律**：每次完成对话的工作后更新本文件（新增条目 / 状态变化 / 条目
> 开始阻塞核心职责时升级标注）。验收报告中出现的同类延后项应归口到此，避免
> 多处散落。
>
> **阶段切换触发**：当延后项开始实质阻塞核心职责（如内测用户撞上安全缺陷、
> 性能瓶颈影响演示、多医院接入需要生产化），或整体成熟度到达临界时，在对话
> 中提醒「项目应该进入下一阶段，应该更新 agents 了」，由用户决策。

## 一、安全类

| # | 事项 | 现状与来源 | 建议批次 |
| --- | --- | --- | --- |
| S1 | 口令轮换批 — **部分完成 2026-08-27**：OM bot secret/OM demo/Superset spike/Doris root ✅（各闭环验证）；**RustFS AK/SK 残留**：被 SeaTunnel 运行中作业定义+双服务引用，需停机窗口 | 安全收敛批报告 | 维护窗口 |
| S2 | .env root 口令清理 — **完成 2026-08-27**：DORIS_PASSWORD 复位 quality_ro（重建隐患消除）、root 移 0600 文件、零残留复检 | 安全收敛批报告 | 完成 |
| S3 | Superset CSP 收紧 — **评估延后**：同源嵌入+Referer 白名单+allowed_domains 三层在位；显式 frame-ancestors 待生产域名定稿（G4 前鉴） | 安全收敛批报告 | 生产化批 |
| S4 | guest-token 缓存/限流 — **完成（2026-09-04，H2）**：限流（nginx 10r/m burst5）+ 按用户维度重设计——（用户 × 仪表盘）TTL 缓存（TTL-30s 安全边际、1000 条上限清过期）、令牌用户名 `portal-` 前缀隔离 Superset 真实账号、ENFORCED 取 JWT 身份 / DISABLED 回落共享访客；dev 实证签发+缓存命中 | 安全收敛批报告 + H2 批次 | **完成** |
| S5 | 网络隔离持久化 — **完成 2026-08-27**：edge-isolation-rules.sh 幂等 + systemd 自启 | 安全收敛批报告 | 完成 |
| S6 | 源库凭据面收敛复查：DM EP_TEST（可写测试账号）、各服务账号授权最小化复核 — **quality_ro 残留项完成 2026-09-02**：dev Doris 已 REVOKE 其对 `dataos_quality_acceptance` 的 SELECT，正负对照 + 失败路径复检验证（证据全部走 audit 表；发现并修正 dev runner 镜像钉旧 G5 tag 的漂移）；余项为全账号面复查 | G3/G5 已按分层授权交付（dataos_om_ro 等），未做全面审计 | 余项生产化批 |
| S7 | ai-ready 服务间 OIDC — **完成（truststore 余项收口 2026-09-04，H2）**：client+audience mapper+issuer 网关对齐；JWKS 自签容错以**内网 JWKS URI 直连**替代（AI_READY/QUALITY_RUNNER/control-plane 三处 jwks-uri 配置，issuer 声明仍按网关值校验；dev compose 已接内网 Keycloak）——免 truststore 工件与证书轮换耦合，truststore 方案留作生产拓扑需要 TLS JWKS 时的替代。注：mpi-service 同型代码未接（dev DISABLED/issuer 空，无现实通道），接线配方一行即成，留 H4 复查 | 安全收敛批报告 + H2 批次 | **完成** |
| S8 | data-api `/internal/**` 强制 OIDC 服务 token — **完成（2026-09-04，H2）**：控制面新增 `data-os.auth.internal-mode`（空值跟随全局；dev 全局 DISABLED 下 /internal/** 独立 ENFORCED，门户免登录迭代不受影响）；Keycloak client `dataos-data-api` + audience mapper（aud=data-os）；dev 实证：无 token 401 / aud=account 拒 401 / 真 token 200，X-API-Key 查询全链（OIDC registry 拉取 + Doris + 审计回写落库）通过；生产全局 ENFORCED 由既有主链承担 | G13 验收报告 + H2 批次 | **完成** |
| S9 | data-api 行级授权 fail-open 缺口 — **完成（2026-09-05，H3）**：CallSession 调决深化（鉴权→绑定→配额单一属主 + 唯一审计出口，全结局含 401/403/429 落审计）；`_hospitals_of` fail-closed（坏 JSON/非数组 → 403 HOSPITAL_SCOPE_INVALID，缺失仍 `["*"]` 与发放语义对齐）；catalog 端点不再绕过调决（配额/绑定照走，元数据读不审计）；registry 不可达收口 503 REGISTRY_UNAVAILABLE。dev 实证负例全过（坏 JSON Key query/export 403 + 审计落库、catalog 200） | 2026-09-04 全库架构走查实锤 + H3 批次（gate-data-api-h3-20260905.md §二） | **完成** |

## 二、生产加固类

| # | 事项 | 现状与来源 | 建议批次 |
| --- | --- | --- | --- |
| P1 | MiNiFi 生产化三收敛：部署完全脚本化、黑盒监控（位点滞后 / 桶断流 / 队列深度告警，补静默失败）、版本冻结 | G5 复盘结论：架构选型对、实现体验差；保留但设条件 | 生产化批 |
| P2 | OM 摄取 / dbt 摄取 / 声明式血缘登记编排进控制面「外部运行」统一状态机（现为脚本触发） | G1 延后项，G6/G7 沿用脚本（om-ingest-doris-assets.sh 等） | 生产化批 |
| P3 | **OM 升级完成并关闭（2026-09-04，H1 批次）**：1.5.11→1.6.0（迁移 263 条 SQL、G6 面零回归、认证链完好）；端点缺陷消除（glossaryTerms 200、testDefinition 85 条）；**余项全清**：① dbt 资产化全量恢复——TestCase 11→96（EP 锚点全在），根因三连：1.6 WorkflowConfig 只收 jwtToken（custom-oidc 被 extra_forbidden 拒）、dbt 1.10 产物 v12/v6 原生可吃但须剥离 metadata 新增键（invocation_started_at/quoting）、令牌时效靠 Keycloak per-client lifespan 1800s；v11 降维链退役；ES DiskThresholdMonitor 卡死事故已修（磁盘 94%→75% + 重启）②「35 条词表重放」判定伪命题（备份 glossary_term=0，35 为 testDefinition 1.5.11 内置数）③ 镜像默认 1.6.0 完成。**残留小项处置（2026-09-05）**：catalog 已补喂（dbt docs generate + 同法 scrub + dbtCatalogFilePath，提交 3d7d3c6）——DataModel=0 实锤为**结构性**：质量工程唯一 model 为 ephemeral，不进 catalog nodes，OM connector 拒建（日志明示）；是否物化一个 view model 属质量工程语义变更，**留用户裁决**。G11 产品 term 回写归 G11 面。历史诊断见 gate-om-upgrade-h1-20260904.md §二/§五/§六 与 gate-data-api-h3-20260905.md §六 | G7/G11 偏差 + 本批诊断实录 + G16c 复查 + H1 终局收口 + H3 姊妹项 | **完成（2026-09-04）**；DataModel 物化裁决待用户 |
| P4 | 遗留服务 `doris-medical` 的 root 连接收敛（data-ops 遗留资产处置） | G1 延后项 | 生产化批 |
| P5 | 断网缓冲容量上限与中转桶生命周期策略（演示验证至 10 分钟缩比，未测长时间大缓冲与桶清理） | G5 L2 缩比口径 | 生产化批 |
| P7 | 数据 API 大结果集异步导出至对象存储 + 下载 URL — **完成（2026-09-05，H3）**：V14 任务状态机（CAS 认领）+ data-api 流式执行（SSCursor→utf-8-sig CSV）→ RustFS 桶 `dataos-data-api-exports` → 鉴权下载回放（不走 presigned）；保留期 7 天 + 启动恢复（孤儿清算/PENDING 拾取）；`kind=export` 审计计入配额。dev 实证 146 行对账零误差（gate-data-api-h3-20260905.md §三） | G13 方案 §九 + H3 批次 | **完成** |
| P8 | 数据 API 网关级全局限流/熔断、审计回写失败持久化缓冲 — **核心完成（2026-09-05，H3）**：nginx `/dataapi/` 2r/s burst 40（80 并发实测 41 过/39 拒）；Doris 熔断 5 连败→30s open→半开试探（query/export 共用）；registry stale-grace 300s（吊销生效延迟=TTL+grace 运维口径）；审计 JSONL 持久缓冲（Idempotency-Key 幂等重放，30s 节拍，72h 超龄丢弃）——停机窗口审计补投实证。**余项延后**：调用方自助门户、合同变更通知（真实调用方出现前无验收对象） | G13 方案 §九 + H3 批次（gate-data-api-h3-20260905.md §四） | **核心完成**；自助门户/合同通知延后 |

## 三、深度测试类

| # | 事项 | 现状与来源 | 建议批次 |
| --- | --- | --- | --- |
| T1 | 全链路压测：SeaTunnel 摄取吞吐、Doris 写入与查询并发、门户 BFF 延迟基线 | 未做过系统性压测（各 gate 为功能验收） | 测试工程批 |
| T2 | MPI 匹配算法效果系统性评测（准确率/召回率评测集与阈值标定；现为规则演示档 + 合成数据） | **完成 2026-08-28（G14）**：冻结评测集 + FS 标定 + V2 影子评分上线（docs/validation/gate-mpi-g14-20260828.md） | 完成 |
| T5 | MPI 决策权混合策略与多源重标定 — **T5a 完成 2026-09-02（G15）含决策权切换**（docs/validation/gate-mpi-g15-20260902.md §五之二）；**重标定机制就绪 2026-09-02**：`MpiWeightEstimator`（估计数学单一属主）+ 报告式漂移检测 `MpiDriftReportTests`（-Ddrift.corpus 门控）+ 运行手册 docs/mpi-recalibration-runbook.md + dev 基线跑通（DRIFT 9/27 判为重采样噪声，判据沉淀在手册 §六）；**余项已收敛（2026-09-03 §四执行完毕）**：EP-REG 弱多源重锚 + 重标定完成（tVeto 0.42→-1.09，dev 否决 115→26 误否修复，T5 全项关闭，见 docs/validation/t5b-reanchor-20260903.md §七）；**待真实多源系统**（非同库跨表）接入后按手册重走触发评估 | G14 结论：加性 FS 自动化率结构性低于合取规则，切换需混合策略；评测为半合成口径，真实脏数据分布待多源验证 | 完成（弱多源）；真多源另触发 |
| T3 | 跨服务契约测试自动化（control-plane ↔ quality-runner ↔ mpi-service ↔ SeaTunnel/OM），替代各 gate 手工验收 | 各批 gate 清单手工执行 | 测试工程批 |
| T4 | 故障注入回归：断网/重启循环、组件不可达降级（503 面）、幂等重放等场景的自动化套件 | G5 L2/L3 手工演练过一轮 | 测试工程批 |

## 变更记录

- 2026-08-22：建立台账，归口 G1-G7 各验收报告延后项为首批条目（S1-S6 / P1-P5 / T1-T4）。
- 2026-08-27：G9 交付新增 S7（ai-ready 服务间认证切 OIDC）；无其他新增。
- 2026-08-27（G11）：P3 OM 实例缺陷证据增补（glossaryTerms 引用解析/端点面），升级评估优先级上调。
- 2026-08-27（安全收敛批·A）：P3 诊断定案——容器重建排除运行态损坏，OM 升级为唯一修复路径；重建后全功能面复验零回归（三库对账 PASS）。
- 2026-08-27（G13）：新增 P7（异步导出）、P8（网关级限流等）、S8（/internal OIDC 化）；交付面见 docs/validation/gate-tob-data-api-g13-20260827.md。
- 2026-08-27（安全收敛批·收尾）：S2/S4/S5/S7 完成、S1 部分（RustFS 残留需停机窗口）、S3 评估延后；**运维须知：OM bot secret 轮换须同时更新两个 env 键（DATAOS_OPENMETADATA_CLIENT_SECRET / DATAOS_OM_INGEST_CLIENT_SECRET）+ 0600 文件**（本轮漏键曾致 BFF 断链）。
- 2026-08-28（G14）：T2 完成（评测集+标定+影子评分）；新增 T5（混合策略切换实验+多源重标定）。
- 2026-09-01（Decision Intelligence Roadmap 评审）：无新增延后项；AI 行/列/指标权限、查询证据、拒答与黄金问题回归被定义为未来功能准入门，不归入当前延后加固；OM `glossaryTerms` 版本缺陷继续归口 P3。
- 2026-09-01（下一阶段计划）：无新增安全/生产加固/深度测试项；T5 在计划中拆分为可立即执行的混合策略影子实验（T5a）与须等待真实多源的重标定/决策切换（T5b），在实际实施验收前保持原条目状态；T1/P3/S8 等既有延后边界不并入 G15–G17。
- 2026-09-02（G15）：T5a 完成（混合引擎+评测+影子上线）；T5b（切换裁决与多源重标定）留条目。
- 2026-09-02（G16a 盘点）：无新增安全/生产加固/深度测试项；EP_TEST 盘点确认 `PATIENT` 表含 `PASSWORD`/`CREDENTIALS`/`WECHAT_OPEN_ID` 敏感列，作为 G16b 采集作业级排除约束处理（写入主线计划 §4.1），不立延后项；T5 触发条件部分成立——患者域（C 端注册路径）与门诊路径构成弱多源，待 G16b 入仓后按手册执行。
- 2026-09-03（G16b 交付）：**T5 弱多源首轮读数完成**——EP-REG 第二身份流上线、双流 rebuild（1,493 对）、漂移报告 DRIFT 18/27（card 结构性缺失主导），按手册 §三裁决不更新 packaged；**T5 余项**收敛为：语料生成器按双流真实候选构成重锚（NEG_RATIO 单源锚定失效）+ 注册流人工锚点补充 + 重锚后再评估重标定（`docs/validation/gate-ep-g16b-20260903.md` §四）。S5 隔离脚本按既定豁免机制扩展（SeaTunnel 静态 IP 单项白名单，防横向语义不变），非安全削弱，不立新条目。新增小项：双流 rebuild 同步端点耗时约 5 分钟（1,493 对），规模增长时接外部运行生命周期（P2 编排项顺带）。
- 2026-09-03（G16c 交付）：8 表（ORDER 交易域+机构维度）+ ep_mz_ypcfmx 现代化全链验收（docs/validation/gate-ep-g16c-20260903.md）；**P3 范围扩大**——OM dbt 资产化面（DataModel+TestCase）实效为零，升级窗口一并验证；rr 降维工具收敛上限补丁（batch_results 预剥离）已入库；G16b 报告 DataModel 表述已更正。G16d 候选：INSTITUTION_DRUG_CATALOG 系 + 药品主数据 + PATIENT_MEDICINE/ADDRESS。
- 2026-09-03（G16d 交付）：14 表（机构药品目录系+药品主数据+患者用药/地址）全链验收，35/35 规则全绿、14 表对账精确一致（docs/validation/gate-ep-g16d-20260903.md）；无新增延后项。两条工程事实入档：Doris stream load 标签 ≤128 字符、质量选择器 ≤42 字符（失败表 64 预算）——后续批次命名须先算预算。
- 2026-09-03（T5b 重锚）：语料 NEG_RATIO 重锚 + 跨流真实正样本 + 4 条派生锚点入仓库（57/57 全绿）；重锚后 DRIFT 23/27（真实信号：name.mAgree→0.804、gender.mDisagree→0.152、tVeto 零误否界→-1.09），锚点实证现行 tVeto 双流误否。**T5 余项收敛为单项：§四 重标定执行（人工决策，证据与建议见 docs/validation/t5b-reanchor-20260903.md §五）**。
- 2026-09-03（T5b §四 执行）：重标定完成——packaged 更新（tVeto 0.42→-1.09 等）、估计器双参安全审计口径入仓库、57/57 全绿、dev rebuild 否决 115→26（误否修复）、AUTO 360 不动。**T5 全项关闭**（下一真实来源系统接入后按手册重走触发评估）。详见 docs/validation/t5b-reanchor-20260903.md §七。
- 2026-09-03（G16e 交付）：消费面深化——Superset 4 数据集+4 图表挂 dashboard 2、Data API 两数据集（科室日汇总/用药日汇总）实调对账零误差（docs/validation/gate-ep-g16e-20260903.md）。无新增延后项；data-api registry 缓存 30s（新 Key 延迟可见）为运维口径记录。
- 2026-09-03（生产化批次评审）：产出 docs/production-hardening-batch-plan-20260903.md——备忘账 17 条活跃项划分为 H1（OM 升级）/H2（认证）/H3（Data API）/H4（编排运维）/H5（测试工程）五批次（26-40 人日），含四项事实核查与依赖关系；T5 条目行同步 §四 完成状态。批次执行仍待用户逐批明示；阶段定位提醒已按 AGENTS.md 纪律向用户正式提出。
- 2026-09-04（H1 批次·用户批准）：OM 1.5.11→1.6.0 升级执行完毕（gate-om-upgrade-h1-20260904.md）——P3 主体关闭，三项余项留条目；AGENTS.md 阶段定位切换为「生产化收口与功能迭代并行」（用户裁决）。载荷坑入记忆：crash-loop 容器内 exec 跑 migrate 会被重启杀死（须 compose run --rm）；1.6 首启 ES 重建约 5-8 分钟。
- 2026-09-04（文档对齐 + 架构走查）：README/docs 一致性核对修正 4 份文档（CONTEXT.md 证据形状、environment-access-reference 的 Doris 库范围与 dataos_quality_ro 边界、technical-architecture 的 MPI 基线 HAPI FHIR→mpi-service 与分析端点、deploy/production/README 通知必配项 HEALTH_URL 改可选）；全库架构走查（improve-codebase-architecture）产出 7 候选报告（浏览器临时文件，未入仓），**新增 S9**（data-api fail-open 实锤，归 H3）。
- 2026-09-04（H1 余项追记）：glossaryTerms 写路径修复实证——**UUID 引用跨版本解析失败、名字引用可用**（重要 API 事实，om-sync-ai-product.sh 已修仓库侧）；dbt 摄取恢复升级为「ingestion 1.6 认证形态适配」工程项（0.5-1 人日，七次重跑线索齐全 dev /tmp/om16-g7-retry*.log），保留 P3 余项；om-ingest 三脚本默认镜像已切 1.6.0（仓库侧）。
- 2026-09-05（H3 批次·用户批准 + 两姊妹项）：**S9/P7/P8 核心全部关闭**（CallSession 调决深化 + fail-closed；异步导出至 RustFS + 鉴权下载 146 行零误差对账；限流/熔断/stale-grace/审计持久缓冲全实证）——gate-data-api-h3-20260905.md；P8 余项（自助门户/合同通知）改写为延后口径。姊妹项：① P3 残留小项 catalog 补喂完成，DataModel=0 实锤结构性（ephemeral-only），物化裁决留用户；② H2 未竟面「生产 ENFORCED 门户用户链」归档 deploy/production（keycloak-portal-seed.sh + build-portal.sh + README），dev PKCE 全流程 + 浏览器登录实证，四个载荷坑入档（KC26 声明式 userProfile 静默丢属性、users PUT 整实体替换、VERIFY_PROFILE 拦首登、PKCE 需 secure context）。dev 运行态切 0.2.0-h3-20260905 双镜像（V14 迁移成功，RustFS 新桶在位）。
