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
| P8 | 数据 API 网关级全局限流/熔断、审计回写失败持久化缓冲、调用方自助门户、合同变更通知 — **全项完成**：核心 2026-09-05（nginx `/dataapi/` 2r/s burst 40；Doris 熔断 5 连败→30s open；registry stale-grace 300s；审计 JSONL 持久缓冲幂等重放）；**余项 2026-09-10 收口（用户明示解除延后）**：V15 三表（订阅/合同事件/投递发件箱）+ 合同事件引擎（PUBLISHED/UPDATED/DEPRECATED/TEST + 字段级 diff + 版本自增，PUT 更新端点）+ HMAC 签名 webhook 推送（签名头与治理通知同形态）+ 轮询兜底通道 + data-api 自助面（/v1/me、/v1/usage/calls、/v1/contract-events、订阅 CRUD/TEST）+ 前端工作台合同区块。E2E 实证含收据-轮询逐事件对应；**修复 E2E 抓出的真缺陷**（DEPRECATED 后 Key 从 registry 消失致自助面 401——自助面认证语义改为 Key 身份，registry 保留下线服务 Key 标 serviceStatus，执行面仍只认 PUBLISHED）。详见 gate-data-api-h3-20260905.md §四/§八 | G13 方案 §九 + H3 批次 | **完成（全项）** |

## 三、深度测试类

| # | 事项 | 现状与来源 | 建议批次 |
| --- | --- | --- | --- |
| T1 | 全链路压测：SeaTunnel 摄取吞吐、Doris 写入与查询并发、门户 BFF 延迟基线 | 未做过系统性压测（各 gate 为功能验收） | 测试工程批 |
| T2 | MPI 匹配算法效果系统性评测（准确率/召回率评测集与阈值标定；现为规则演示档 + 合成数据） | **完成 2026-08-28（G14）**：冻结评测集 + FS 标定 + V2 影子评分上线（docs/validation/gate-mpi-g14-20260828.md） | 完成 |
| T5 | MPI 决策权混合策略与多源重标定 — **T5a 完成 2026-09-02（G15）含决策权切换**（docs/validation/gate-mpi-g15-20260902.md §五之二）；**重标定机制就绪 2026-09-02**：`MpiWeightEstimator`（估计数学单一属主）+ 报告式漂移检测 `MpiDriftReportTests`（-Ddrift.corpus 门控）+ 运行手册 docs/mpi-recalibration-runbook.md + dev 基线跑通（DRIFT 9/27 判为重采样噪声，判据沉淀在手册 §六）；**余项已收敛（2026-09-03 §四执行完毕）**：EP-REG 弱多源重锚 + 重标定完成（tVeto 0.42→-1.09，dev 否决 115→26 误否修复，T5 全项关闭，见 docs/validation/t5b-reanchor-20260903.md §七）；**待真实多源系统**（非同库跨表）接入后按手册重走触发评估 | G14 结论：加性 FS 自动化率结构性低于合取规则，切换需混合策略；评测为半合成口径，真实脏数据分布待多源验证 | 完成（弱多源）；真多源另触发 |
| T3 | 跨服务契约测试自动化（control-plane ↔ quality-runner ↔ mpi-service ↔ SeaTunnel/OM），替代各 gate 手工验收 | 各批 gate 清单手工执行 | 测试工程批 |
| T4 | 故障注入回归：断网/重启循环、组件不可达降级（503 面）、幂等重放等场景的自动化套件 | G5 L2/L3 手工演练过一轮 | 测试工程批 |

## 门户 UX 评审延后项（2026-09-14 critique 收口后余项）

| 编号 | 事项 | 说明 | 归口 |
|---|---|---|---|
| U1 | 平台运维页设计系统离群收编 | **完成 2026-09-14（余项修复轮）**：深色 hero 移除、PageHeader + 纸面探针摘要卡、字距/阴影回归规范 | 完成 |
| U2 | 队列选中态与可点行可达性 | **完成 2026-09-14（余项修复轮）**：两队列 aria-pressed、治理可点行键盘可达 + 焦点环 | 完成 |
| U3 | 效率层增强 | **部分完成 2026-09-14（余项修复轮）**：?issue=/?task= 深链 + ⌘K 命令面板已交付；MPI 批量决策仍逐条（保留条目，待真实复核量级评估再设计） | 部分完成 |
| U4 | MetricStrip 固定 6 列网格泛化 | **完成 2026-09-14（余项修复轮）**：.metrics/.metricStrip 改 auto-fit + 1px gap hairline，nth-child 补丁全删 | 完成 |

## AI Data 线候选（2026-09-15 四问拷问析出）

> 背景：grill-me 拷问「模块是否就绪 / 6C 如何体现 / Data-Juicer 如何集成 / 是否满足 AI ready 数据集要求」四问，
> 裁决口径为内部 gate 判据（机制就绪、证据真实、边界诚实）。

| 编号 | 事项 | 说明 | 归口 |
|---|---|---|---|
| AI-1 | 6C 检查项补厚 | **完成 2026-09-15（G17）**：10→14 项（column_description_coverage 新探针、chunk_deduplication、chunk_quality_share、ep_lineage_registration），icd/freshness 两项口径演进（可解析率 0.9886、活跃链路水位+dev SLA），OM 补 31 表 13 列描述（docs/validation/gate-ai-ready-g17-20260915.md §二）；**第二批完成 2026-09-16（G20）**：14→17（corpus_source_lag 语料水位、artifact_availability 双落在册对拍-新 rustfs_probe、fhir_mapping_coverage 条件占位），dev 终态 15 PASS + 2 N/A / Overall 1.0（gate-ai-ready-g20-20260916.md） | 完成 |
| AI-2 | 真实医疗语料入 AI 链（外部效度验证） | **完成 2026-09-15（G17）**：EP 域真实采集数据（1,967 处方 chunk，PII 零命中）走完 登记→构建→评估（1.0/CANDIDATE）→评测（recall 0.85/MRR 0.6575）→审批 CERTIFIED→SERVING；评测集 60 问入仓；顺带修复 H2 遗留的控制面→引擎 OIDC 断链 | 完成 |
| AI-3 | SERVING 产品再认证路径 | **完成 2026-09-16（G19）**：状态机新增唯一逆向流转 SERVING→ASSESSED（撤下重评估，两步确认动作同弃用型）；审批门不变量保全（CERTIFIED/SERVING 只经审批进入）；dev 实操 EP 产品 v0.3.0 完整再认证环（撤下→提交→批准→回上架，docs/validation/gate-ai-ready-g19-20260916.md）。零中断换版（serving 指针分离模型）如生产需要另立项 | 完成 |
| AI-4 | 构建 API 异步化 | **完成 2026-09-16（G20）**：V16 任务表 + CAS 认领 worker（单线程执行、启动孤儿清算）+ POST /build 202 投递（双层互斥）+ 门户轮询任务面；dev 实测 202→RUNNING→SUCCEEDED（~6s/732 chunk）、互斥 409、孤儿清扫后可重投（docs/validation/gate-ai-ready-g20-20260916.md）。**余项归 AI-5** | 完成 |
| AI-5 | AI 构建任务终态 webhook 外发（独立通知 outbox） | 任务终态现为持久化+门户轮询呈现；governance_notifications.issue_id 是 NOT NULL FK（治理域锚定），AI 构建事件须独立 outbox（租约/退避语义同款）；多实例部署的执行面租主比对同窗 | 生产化批候选 |

注：Data-Juicer 真实引入维持「网络恢复后替换执行器后端、Recipe 不变」的条件挂起（G10 延后清单在案），本次口径重申，无状态变化。

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
- 2026-09-10（P8 余项收口·用户明示解除延后）：**P8 全项关闭**——自助门户（data-api /v1/me、/v1/usage/calls、/v1/contract-events、订阅 CRUD/TEST）+ 合同变更通知（V15 三表、事件引擎含字段级 diff 与版本自增、HMAC 签名 webhook 推送与治理通知同签名形态、轮询兜底、订阅端点策略默认公网 HTTPS）+ 前端工作台合同/导出区块。E2E 收据-轮询逐事件对应实证；**修复 E2E 抓出的真缺陷**（DEPRECATED 后 Key 从 registry 消失致自助面 401——自助面认证语义 = Key 身份而非「服务在售」，registry 保留 DEPRECATED 服务 Key 标 serviceStatus + deprecatedServices 契约视图，执行面仍只认 PUBLISHED）；载荷坑：@Value 裸属性名对 DATAOS_DATA_API_* 形态 env 键不适用宽松绑定（application.yml 显式 ${ENV:default} 声明解决）。测试基线 control-plane 211/211、data-api 44/44、前端全绿；dev 切 0.2.0-h3p8-20260910 双镜像（V15 迁移成功）。
- 2026-09-14（门户 9 页 UX 评审收口）：impeccable critique（21/40 基线，快照 prototype/.impeccable/critique/，工具态已 gitignore）后四批次收口——P0 数据服务/AI Data 布局错位四连（新建表单进 Drawer、两栏工作区、详情容器左缘统一、概览 auto-fit）；P1 硬缺陷（MPI metricStrip 裸渲染、治理排行恒"1"、RuntimeStatusBanner 部分载荷白屏、window.prompt 取消提交空值、平台运维加载态误报）；P1 全站分页（usePaged+Pager 铺开 6 页面 11 处，含 MPI 100 条截断诚实提示）；P1 去品牌（OpenMetadata×6/Superset 全清 + AI 枚举中文口径 + qa 正则锁）；P2 动作过载（任务行 7→≤4 按钮+更多菜单、弃用/下线两步确认、首页死胡同、治理红色警示去重、分析空态锚点）。发现并修复两类工程坑：hooks 早退分支违规（AIDataDetail/DataServices/AIData rail，启动即白屏，经 index.html 临时错误陷阱定位）；qa 正则锁大小写敏感设计（@superset-ui 包名小写不受 /Superset/ 锁影响）。余项 U1-U4 立条目。
- 2026-09-14（UX 余项修复轮·用户「继续修复余项」）：U1/U2/U4 完成、U3 部分完成——平台运维页收编设计系统（PageHeader+纸面探针卡，⌘K 面板与命令原语复用 Drawer 焦点语义）；队列选中态 aria-pressed 与可点行键盘可达；指标带 auto-fit hairline 泛化（两项原语统一技法，删全部 nth-child 边框补丁）；?issue=/?task= 深链（读参数+replaceState 回写，对齐 ?asset= 口径）与全局命令面板（⌘K，listbox/option 语义，技术域入口按角色过滤）。U3 余下「MPI 批量决策」保留条目——按评审口径，批量决策需先看真实复核量级（dev 7 条/日 vs 上线后量级）再定交互形态，不宜先造。提交 8b848e8..5046942，每步全绿。
- 2026-09-15（AI Data 四问拷问·grill-me）：定稿内部 gate 答底稿——①就绪=机制面（G8–G12 全交付）+ 三边界声明；②6C 三层展开+主动标界（六维框架/10 检查项/Profile 加权阈值）；③Data-Juicer 维持条件挂起、降级裁决讲成架构资产（Recipe 语义对齐+执行器可替换）；④满足要求双层拆开（机制自证满足/真实语料外部效度未证）。新增 AI-1（6C 检查项补厚）、AI-2（真实医疗语料入 AI 链）两条候选，不排期。
- 2026-09-15（G17 交付）：**AI-1/AI-2 全部关闭**——6C 检查项 10→14（含 icd/freshness 口径演进）+ OM 补 31 表 13 列；EP 真实采集语料 1,967 chunk 全链至 SERVING（评估 1.0、评测 recall 0.85/MRR 0.6575、PII 零命中），评测集 60 问入仓（docs/validation/gate-ai-ready-g17-20260915.md）。**S7 追记**：H2 批次遗漏的控制面→引擎 OIDC 透传（compose 仅静态令牌、引擎 S7 后只认 OIDC，自 G12 后该链路未复测）由 G17 实测踩出并修复（deploy/dev compose 补三件套）；工程坑三条入档（评测集正则灾难性回溯、空表 SUM NULL 判 0、/evaluate ORDER BY 确定性）。
- 2026-09-16（G18 交付）：AI Data 工作流闭环——引擎 POST /build（构建执行面 API 化，reset_before_write）+ 控制面 recipeRef 解析序（请求??版本登记，门户 build 按钮真实构建）+ /ai-data?product= 深链；**真实语料飞轮首轮**：失败归因（时分秒稀释日期 token，ENT+替诺福韦簇 6/9）→ feedback→处置→recipe v1.1（date_only_columns）→ v0.3.0 经 build API 19s 完成→评测 recall 0.9833/MRR 0.9208（docs/validation/gate-ai-ready-g18-20260916.md）。飞轮中实抓两个真缺陷修复：write_doris 逐行连接 504（362/1967 部分写入现场，批量 executemany 后 19s）、Java Stream.findFirst 对 null recipeRef 的 NPE。新增 AI-3（SERVING 再认证路径缺口）、AI-4（构建异步化）。dev 切 0.2.0-g18-20260915 双镜像。
- 2026-09-16（G19 交付）：**AI-3 关闭**——SERVING→ASSESSED 唯一逆向流转（撤下重评估），审批门不变量零改动；门户两步确认动作；dev 实操 EP 产品 v0.3.0 完整再认证环闭合（两代版本两次审批，docs/validation/gate-ai-ready-g19-20260916.md）；dev control-plane 切 0.2.0-g19-20260916、门户 dist 热更。零中断换版（serving 指针分离）留档不立项。
- 2026-09-16（G20 交付）：**AI-4 关闭 + 检查项补厚第二批（14→17）**——V16 ai_data_build_job 任务态（CAS 认领/单线程执行/启动孤儿清算，先例对齐 V14 异步导出）+ POST /build 202 投递（产品级活动检查 + 版本 build_status CAS 双层互斥）+ 门户轮询与「构建任务」区块；新检查 corpus_source_lag / artifact_availability（rustfs_probe）/ fhir_mapping_coverage（条件占位），dev 终态 15 PASS + 2 N/A / Overall 1.0。**飞轮式实抓真缺陷一个**：corpus_source_lag 公式反向（首测 311.42h WARN，真实 0——语料新于源水位；修复含 built_at UTC→+08 壁钟归一，会话时区偏差在差值中相消）。新增 AI-5（AI 构建终态 webhook 独立 outbox + 多实例租主比对，生产化批候选）。dev 切 0.2.0-g20-20260916 双镜像 + 门户 dist 热更；工程坑：版本状态 CAS 自阻断（终态回写须无条件）、nginx 缓存容器 IP 老坑重现（重建后端必重启 portal）。
- 2026-09-16（G20 追记·用户实测报告）：**dev 门户登录门误入包**——本机遗留 `prototype/.env.production`（H3 登录链验证配置，未入仓）被 Vite 生产模式自动加载，npm run build 出的 dev 门户 dist 带 OIDC 登录门；用户点登录报 `ERR_CERT_AUTHORITY_INVALID`（dev 网关 8443 自签证书浏览器不信任），且该门在非 localhost HTTP origin 上本就无法完成（PKCE 需 secure context）。处置：删除遗留文件、重建无门 dist（bundle 无 8443/realms 串实证）、重发 dev portal-dist；G18/G19 轮 dist 同配方带门追认在 gate 文档；「部署 dev portal-dist 前查 bundle」守卫记 deploy/dev/README.md。无新增延后项。
- 2026-09-18（文档一致性巡检 + README 重制）：常驻文档对照实现检查——修正 3 处失真（AGENTS.md 子工程清单五→六、补 `services/data-api/`；根 README 与 `docs/architecture/ai-ready-data.md` 的「待 G8 评审批准」注记改为实施基线，依据 gate-ai-ready-g8-20260827 验收 8/8）；根 README 按 readme-generator 重制（名片式首屏 + `assets/banner.webp`/`features.webp` 两图 + 六子工程职责表，文档地图、运行模式边界与命令保留）；GitHub description/topics 更新（9 topics）。无新增延后项。
- 2026-09-20（下一阶段功能补齐规划）：形成 G21–G26 计划，范围限定为现有功能可信基线、数据标准、标准映射、管理/运营中心、交付中心与受控问数；无新增安全/生产加固/系统性深测条目。生产 Compose 补齐仍归 H4 复查，完整 CI 矩阵与跨服务自动化仍归 H5/T3，不并入功能提交；计划待用户批准，尚未启动 G21。
- 2026-09-21（G21 功能可信基线收口）：CI 恢复全绿（2026-09-14 起连续 8 红后首绿，run 35527419117）+ 两服务镜像 CVE 清零 + data-api claim 双缺陷/审计回写/Key 管理员专享 + ai-ready 清单真实性（manifest_probe，检查批 17→18）+ dev 分析看板 503 根因闭环（FAB protect() 对 Public 持有权限跳过 JWT 校验——嵌入链授权迁专用角色 embedded_guest，永不挂 Public，守卫记 dev Superset 配置注释）。新增三项延后候选：① quality-runner CI 安装清单与 pyproject 双轨漂移（本轮已按 import 闭包补全，正路是 CI 从 pyproject 派生安装）；② dbt-core 1.10→1.12 升级仅本地测试验证，dev 重部署后 quality/dbt 项目真实运行待核验；③ mpi-service 依赖 CVE 面未扫（CI 无 mpi job，Spring Boot 3.4.x 栈同款暴露，归 H5 CI 矩阵）。
- 2026-09-21（G22+G24 交付）：数据标准中心（V17 五表 + 12 固定接口 + 同步重试补口、不可变版本/评审发布/停用、OM 词表投影 SYNC_PENDING 闭环、CSV/JSON 导入 dry-run 先行、FHIR 导出无内部标识）与运营投影（/api/v1/operations 三接口、驾驶舱去静态化、运营中心一级路由、横幅组件覆盖数、MPI 条件客户端）落成；control-plane 238/238 + 门户全链 + CI 绿（35551955796）。两 gate 的 dev 真实链路证据已于 2026-09-21 补齐（镜像 0.2.0-g22-g24-20260921 上 dev；OM 词表「数据标准」实投影 SYNCED 且术语可见、摘要/明细真实数据对拍一致、MPI 投影 UP/1128、Superset 503 诚实降级——见两份 gate 文档 dev 证据节）。**dev 实测再抓真缺陷一个**：OM 1.6 CreateGlossaryTerm.glossary 只收词表名/fqn 字符串（对象 400、裸 id 404），初版客户端已修正。新增延后候选：① 运营投影的下钻 deepLink 目前覆盖五个门户路由，问题闭环/合同视图入口随 G23 补；② 标准导入 CSV 校验错误只带行号不带列定位（可用性项）。
- 2026-09-21（G23 标准映射交付）：V18 五表 + mapping 模块（checksum 门控激活/指针 CAS 并发/回退/受控转换白名单）+ 质量执行器只读聚合验证契约（登记面 + 聚合输出无行数据）+ ai-ready fhir_mapping_coverage 换 ACTIVE 映射覆盖率投影（N/A/FAIL 双向 dev 实测）+ 门户映射页接真与治理导航三入口；dev 以 ods_ep.ep_mz_cfzb 完成导入→验证（99.86% 覆盖率/11423 行）→评审→生效→影响→回退全链。dev 实抓并修复两处设计缺陷（空草稿建集被误拦、无 ACTIVE 映射时覆盖率应为 null）。新增延后候选：① 映射验证阈值（0.90/0.98）与窗口为常量，门户不可配置；② 生产 ENFORCED 下 ai-ready→控制面投影的带角色 token（当前 dev 公开端点免鉴权直读），归 H4/H5 鉴权矩阵。
- 2026-09-22（G25 交付中心交付）：V19 四表 + delivery 模块（10 固定接口、READY 前逐项可交付性阻断、幂等键快照/状态动作、白名单证据包 fail-closed 清洗器）+ 门户交付中心一级路由闭环；dev 以 Dashboard+Data Service+SERVING AI 产品完成建项→验收→下载全链，checksum 与白名单逐项复核通过（docs/validation/gate-g25-20260922.md）。dev 实抓并修正一处口径（合同证据=定义行可读，事件史可为空如实呈现）。新增延后候选：① 交付项目无删除/取消端点（误建项目只能留 DRAFT）；② 多交付项大项目提交时逐项远程证据采集为串行（OM/Superset 时延放大），规模化后并行化；③ `GET /api/v1/data-services` 不带 tenantId 返回 0（controller 未走 TenantScope 默认租户解析，`?tenantId=default` 正常）——G25 顺带发现的既有行为，与交付链无关。
