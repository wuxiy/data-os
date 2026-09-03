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
| S4 | guest-token 缓存/限流 — **限流完成 2026-08-27**（nginx 10r/m burst5，200→503 实测）；按用户维度重设计仍待认证批次 | 安全收敛批报告 | 认证批次（余项） |
| S5 | 网络隔离持久化 — **完成 2026-08-27**：edge-isolation-rules.sh 幂等 + systemd 自启 | 安全收敛批报告 | 完成 |
| S6 | 源库凭据面收敛复查：DM EP_TEST（可写测试账号）、各服务账号授权最小化复核 — **quality_ro 残留项完成 2026-09-02**：dev Doris 已 REVOKE 其对 `dataos_quality_acceptance` 的 SELECT，正负对照 + 失败路径复检验证（证据全部走 audit 表；发现并修正 dev runner 镜像钉旧 G5 tag 的漂移）；余项为全账号面复查 | G3/G5 已按分层授权交付（dataos_om_ro 等），未做全面审计 | 余项生产化批 |
| S7 | ai-ready 服务间 OIDC — **完成 2026-08-27**：client+audience mapper+issuer 网关对齐；JWKS 容自签为 dev 口径（生产化换 truststore） | 安全收敛批报告 | 完成（truststore 项归生产化） |
| S8 | data-api `/internal/**` 强制 OIDC 服务 token — dev control-plane 为 DISABLED 直通（与 /api 同水平）；切 ENFORCED 时建 Keycloak client `dataos-data-api` + audience mapper（S7 模式，compose 键位已预留） | G13 验收报告 | 认证批次 |
| S9 | data-api 行级授权 fail-open 缺口：`_hospitals_of`（services/data-api/app/api.py:70）解析 `allowedHospitals` 坏 JSON 时静默回退 `["*"]`（全院放行），零直接测试；同文件 catalog 端点绕过 `_require_key` 内联复制 401 分支、`report_call` 4 处手调。修复建议随「CallSession 调决深化」（架构评审候选 1）一并收敛，医院解析改 fail-closed | 2026-09-04 全库架构走查实锤（报告见临时目录 architecture-review-20260904） | H3（Data API 批） |

## 二、生产加固类

| # | 事项 | 现状与来源 | 建议批次 |
| --- | --- | --- | --- |
| P1 | MiNiFi 生产化三收敛：部署完全脚本化、黑盒监控（位点滞后 / 桶断流 / 队列深度告警，补静默失败）、版本冻结 | G5 复盘结论：架构选型对、实现体验差；保留但设条件 | 生产化批 |
| P2 | OM 摄取 / dbt 摄取 / 声明式血缘登记编排进控制面「外部运行」统一状态机（现为脚本触发） | G1 延后项，G6/G7 沿用脚本（om-ingest-doris-assets.sh 等） | 生产化批 |
| P3 | **OM 升级完成（2026-09-04，H1 批次）**：1.5.11→1.6.0（迁移 263 条 SQL、G6 面零回归、认证链完好）；**端点缺陷消除**：glossaryTerms 200、testDefinition 内置 85 条。**余项**：① dbt 资产化全量恢复（重跑 token 过期 + 97 errors 排查，半日）；② glossary 35 条词表 seed 重放；③ om-ingest 脚本默认镜像版本更新。原记录（2026-08-27 诊断）：：DB seed 完好（35 定义）、ES 健康、**容器重建（全新 JVM）后症状不变**——排除运行态，为版本级缺陷（升级才修）。修复路径：OM ≥1.6 升级 + 数据卷迁移重放（或全新卷重建）；升压前置：Keycloak/Superset 联动面检查。**范围扩大（2026-09-03，G16c 复查）**：dbt 资产化面（TestCase + DataModel 挂靠）在 OM 1.5.11 上实效为零——实体面查询 DataModel 全局 0、TestCase 0，工作流「Processed/Success」为内部计数非落库实体；G6 表结构资产面不受影响。升级后须一并验证 G7 面恢复。关联受阻项：G7 TestCase registrar、G11 term 回写（脚本 best-effort 段就绪） | G7/G11 偏差 + 本批诊断实录 + G16c 复查 | 生产化批（升级窗口） |
| P4 | 遗留服务 `doris-medical` 的 root 连接收敛（data-ops 遗留资产处置） | G1 延后项 | 生产化批 |
| P5 | 断网缓冲容量上限与中转桶生命周期策略（演示验证至 10 分钟缩比，未测长时间大缓冲与桶清理） | G5 L2 缩比口径 | 生产化批 |
| P7 | 数据 API 大结果集异步导出至对象存储 + 下载 URL（§5.8 完整形态；当前 maxRows 截断挡住） | G13 方案 §九 | 生产化批 |
| P8 | 数据 API 网关级全局限流/熔断、审计回写失败持久化缓冲、调用方自助门户、合同变更通知 | G13 方案 §九 | 生产化批 |

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
