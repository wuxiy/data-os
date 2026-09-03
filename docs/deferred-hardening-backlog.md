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

## 二、生产加固类

| # | 事项 | 现状与来源 | 建议批次 |
| --- | --- | --- | --- |
| P1 | MiNiFi 生产化三收敛：部署完全脚本化、黑盒监控（位点滞后 / 桶断流 / 队列深度告警，补静默失败）、版本冻结 | G5 复盘结论：架构选型对、实现体验差；保留但设条件 | 生产化批 |
| P2 | OM 摄取 / dbt 摄取 / 声明式血缘登记编排进控制面「外部运行」统一状态机（现为脚本触发） | G1 延后项，G6/G7 沿用脚本（om-ingest-doris-assets.sh 等） | 生产化批 |
| P3 | **OM 1.5.11 testDefinitions/glossaryTerms 端点缺陷（诊断定案 2026-08-27）**：DB seed 完好（35 定义）、ES 健康、**容器重建（全新 JVM）后症状不变**——排除运行态，为版本级缺陷（升级才修）。修复路径：OM ≥1.6 升级 + 数据卷迁移重放（或全新卷重建）；升压前置：Keycloak/Superset 联动面检查。**范围扩大（2026-09-03，G16c 复查）**：dbt 资产化面（TestCase + DataModel 挂靠）在 OM 1.5.11 上实效为零——实体面查询 DataModel 全局 0、TestCase 0，工作流「Processed/Success」为内部计数非落库实体；G6 表结构资产面不受影响。升级后须一并验证 G7 面恢复。关联受阻项：G7 TestCase registrar、G11 term 回写（脚本 best-effort 段就绪） | G7/G11 偏差 + 本批诊断实录 + G16c 复查 | 生产化批（升级窗口） |
| P4 | 遗留服务 `doris-medical` 的 root 连接收敛（data-ops 遗留资产处置） | G1 延后项 | 生产化批 |
| P5 | 断网缓冲容量上限与中转桶生命周期策略（演示验证至 10 分钟缩比，未测长时间大缓冲与桶清理） | G5 L2 缩比口径 | 生产化批 |
| P7 | 数据 API 大结果集异步导出至对象存储 + 下载 URL（§5.8 完整形态；当前 maxRows 截断挡住） | G13 方案 §九 | 生产化批 |
| P8 | 数据 API 网关级全局限流/熔断、审计回写失败持久化缓冲、调用方自助门户、合同变更通知 | G13 方案 §九 | 生产化批 |

## 三、深度测试类

| # | 事项 | 现状与来源 | 建议批次 |
| --- | --- | --- | --- |
| T1 | 全链路压测：SeaTunnel 摄取吞吐、Doris 写入与查询并发、门户 BFF 延迟基线 | 未做过系统性压测（各 gate 为功能验收） | 测试工程批 |
| T2 | MPI 匹配算法效果系统性评测（准确率/召回率评测集与阈值标定；现为规则演示档 + 合成数据） | **完成 2026-08-28（G14）**：冻结评测集 + FS 标定 + V2 影子评分上线（docs/validation/gate-mpi-g14-20260828.md） | 完成 |
| T5 | MPI 决策权混合策略与多源重标定 — **T5a 完成 2026-09-02（G15）含决策权切换**（docs/validation/gate-mpi-g15-20260902.md §五之二）；**重标定机制就绪 2026-09-02**：`MpiWeightEstimator`（估计数学单一属主）+ 报告式漂移检测 `MpiDriftReportTests`（-Ddrift.corpus 门控）+ 运行手册 docs/mpi-recalibration-runbook.md + dev 基线跑通（DRIFT 9/27 判为重采样噪声，判据沉淀在手册 §六）；**余项**：真实多源接入后按手册执行重标定 + 锚点补充 | G14 结论：加性 FS 自动化率结构性低于合取规则，切换需混合策略；评测为半合成口径，真实脏数据分布待多源验证 | 余项生产化批 |
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
