# 院内采集全流程模拟验收清单（前置机隔离 / 实时采集 / 治理 / MPI / 血缘 / Superset）— 2026-08-19

状态：**顺延——先完成门户功能迭代（MPI/血缘/分析三页真实化），迭代完成后按门户口径修订本清单再执行**（2026-08-19 决策：演示导向、受控外链仅面向技术用户不作为甲方口径）。L4/L5/L6 的组件侧锚点（OpenMetadata 摄取 ods_ep、Superset 建图、Doris 匹配实验）纳入迭代 G1 先行完成；L1/L2/L3（前置机隔离/断网/质量）维持原样。

## 0. 目标拓扑与已实测现状

```
[院内隔离网段（模拟）]                         [平台网络 medical-platform_platform-net]
DM 192.168.17.76:5236 (EP 业务库)
   │  唯一放行出站：minifi-net 子网 → 5236（iptables 强制）
   ▼
minifi-edge（MiNiFi 2.10 Java，前置机）──出站投递──▶ RustFS 中转桶 dataos-edge-relay（S3）
   本地 content repository = 断网缓冲                    │
                                                        ▼
                                        SeaTunnel（S3 源 → Doris）◀── 控制面任务/状态机/门户
                                                        ▼
                                        Doris ods_ep（UNIQUE KEY(ID) 增量表）
                                                        ▼
                              质量运行器(dbt) ｜ OpenMetadata(血缘) ｜ Superset(图表)
```

| # | 现状事实（本轮全部实测） |
| --- | --- |
| 1 | `minifi-edge` 容器在运行（`apache/nifi-minifi:2.10.0`，`minifi_minifi-net` 172.22.0.0/16，挂载 `/root/medical-platform/deploy/minifi/conf`，flow 为 flow.json.gz）；**容器→DM 5236 实测连通**，含 curl/JRE |
| 2 | DM `EP_TEST` 权限：CREATE SESSION / RESOURCE / PUBLIC；**可建表可插数**（探针表建删成功）→ 可模拟新增处方数据；无 V$/SYSOBJECTS/归档权限 |
| 3 | **日志 CDC 不可用**（上条权限结论 + SeaTunnel 2.3.13 官方 CDC 源仅 MySQL/Oracle/SQLServer/PostgreSQL/MongoDB 等，无达梦）→ 按「源库若支持 CDC」的条件分支，本轮以轮询增量替代并出具正式结论 |
| 4 | 门户 MPI/血缘/分析页为**静态演示**（`MpiReviewPage` 引 `data/mock`，无 controlPlane API；无任何 Superset 集成）；OpenMetadata（网关 8445）/ Superset（网关 8444）/ RustFS（19000）在 dev 环境运行健康 |
| 5 | 质量规则机制：`quality/dbt` 工程 + `services/quality-runner/rules.yml` + 镜像内置 + PostgreSQL 注册表；现有规则只指向合成验收表，**EP 规则需开发** |
| 6 | Doris `dataos_quality_ro` 仅可读质量库；EP 直连链路（上一轮 Gate）可作为隔离前对照组 |

## 决策点（请逐项确认，推荐项已标注）

| # | 决策 | 选项 |
| --- | --- | --- |
| D-1 | 前置机→中心投递通道 | **RustFS S3 中转（推荐，符合蓝图对象证据层与文件幂等语义）**；宿主 LocalFile 中转（轻量但绕过对象层）；直投 Doris Stream Load（绕过平台任务面，不推荐） |
| D-2 | 实时采集实现 | **分钟级轮询增量（推荐；EP 增量窗口上一轮已实证）**；追加触发器软 CDC（P2 可选，EP_TEST 可建触发器）；真实日志 CDC 仅出「不可用」结论 |
| D-3 | 源端数据模拟方式 | **向 `EP_MZ_CFZB`/`EP_MZ_YPCFMX` 插入标记 ID 段（ID ≥ 910,000,000）合成行（推荐，最真实；验收后删除）**；独立仿真表（隔离性好但链路真实性弱） |
| D-4 | MPI 场景范围 | **Doris 层确定性匹配实验 + 匹配统计报告（推荐，无需新页面）**；门户 MPI 页最小真实化（额外开发量大，建议另行排期） |
| D-5 | 增量入仓幂等模型 | **Doris UNIQUE KEY(ID) 增量表（推荐，重放/重复投递天然不重复，落实蓝图 7.3 幂等语义）**；DUP 表 + 人工对账去重 |
| D-6 | 断网模拟强度 | **阻断前置机→中心链路 20 分钟 + 持续产数（推荐缩比，验证机制而非 72h 容量）**；更长窗口（时间成本高，不建议本轮） |

## E. 工程改动（先行交付，全绿后逐项独立提交）

| # | 项目 | 通过标准 |
| --- | --- |
| E1 | SeaTunnel 镜像增 S3 源连接器（connector-file-s3）或 D-1 选定通道对应连接器，重建 `2.3.13-dataos.4` | 镜像内连接器就位；容器内对 RustFS 端点连通 |
| E2 | quality-runner 增 EP 规则包：`quality/dbt` 增 `ods_ep` sources + ≥3 条测试（主键唯一非空、`CFPTZT` 值域、明细外键引用），`rules.yml` 注册 | 本地 pytest 全绿；镜像重建后注册表含 EP 规则 |
| E3 | control-plane 增边缘模板 `EP_EDGE_S3_TO_DORIS`（source=S3（中转桶）、sink=Doris UNIQUE 表），或确认走 CUSTOM_JSON 边界 | 模板校验单测通过；mvn 全量零修改全绿（新增测试除外） |
| E4 | Doris：建 UNIQUE KEY(ID) 增量表（`ods_ep.ep_mz_cfzb_edge` 等）；`dataos_quality_ro` 授予 `ods_ep` 只读 | 表 DDL 留证；ro 账号可见 ods_ep |
| E5 | RustFS：建中转桶 `dataos-edge-relay` | 桶存在、写入账号最小权限 |
| E6 | MiNiFi：编写并加载 flow（DBCP→DM 增量拉取按 UPDATE_TIME、PutS3Object、失败重试，启用本地 content repository 持久化） | flow 加载无错误、能产出首批文件到中转桶 |

**门槛**：上一轮 EP 直连链路（Gate 2026-08-18）零回归；mvn / pytest / 前端 qa（若涉及）全绿。

## L1. 隔离拓扑与前置机采集链路（正常路径）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| L1.1 | 隔离强制生效（负向） | iptables 放行仅 minifi-net→DM 5236；从控制面容器直连 DM 的源检查**必须失败**（隔离实证）；minifi→DM 通 |
| L1.2 | 前置机首采 | MiNiFi 增量拉取投 S3；SeaTunnel S3→Doris 任务（控制面登记）SUBMITTED→SUCCEEDED；门户任务页可见 |
| L1.3 | 数据对账 | Doris 增量表行数/主键范围 == 源侧（含合成行）实测值；列数一致 |
| L1.4 | 投递幂等 | 同批文件重放/重复投递一次，UNIQUE 表计数不变（重复文件不产生重复行） |

## L2. 实时性与断网（故障路径，映射蓝图 12.2）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| L2.1 | 端到端时效 | 插入合成行 → Doris 可查，端到端 ≤5 分钟（轮询周期配置留证） |
| L2.2 | 断网缓冲 | 阻断前置机→中心 20 分钟，期间持续产数 N 行；MiNiFi 本地 content repository 增长留证（缓冲实证） |
| L2.3 | 恢复补传 | 解除后自动补传；最终零丢失（增量行数 == N）；补传耗时不劣于产数速率（缩比说明） |
| L2.4 | 前置机重启恢复 | 断链期间重启 minifi-edge，恢复后位点保留，不重不漏 |

## L3. 质量中心场景（映射蓝图 12.1「质量规则失败生成工单，修复后重跑并关闭」）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| L3.1 | EP 规则在册 | 质量注册表含 EP 规则，控制面可按规则发复检 |
| L3.2 | 失败检出 | 制造脏数据（合成行违反值域/主键）→ 复检 FAILED + ≤20 条脱敏样本证据 + 执行批次号 |
| L3.3 | 工单闭环 | 问题生成→处理（工作流状态流转）→复检通过→自动关闭→事件链完整（`governance_issue_events`） |
| L3.4 | 通知投递 | 通知接收器 `/receipts` 收到带 HMAC 的责任人投递回执 |

## L4. MPI 主索引场景（范围按 D-4；映射蓝图 8.1 可达子集）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| L4.1 | 字段标准化+Blocking+确定性匹配 | 在 EP 患者字段（PATIENT_ID/KH/HZXM/HZXB/HZNL）上执行，产出 MATCH / POSSIBLE_MATCH / NO_MATCH 三态统计 |
| L4.2 | 典型场景实证 | ①同人异卡（同 PATIENT_ID 不同 KH）命中 MATCH；②构造近似变体（错别字/空格）落 POSSIBLE_MATCH（用合成行可控构造） |
| L4.3 | 保守策略记录 | 匹配阈值与「错误合并风险高于漏合并」的处置说明入报告；漏合并/误合并统计 |
| L4.4 | 边界标注 | 新生儿/急诊未知患者等蓝图 12.3 边界样本本轮**不**声称覆盖（列入后续） |

## L5. 数据血缘场景（OpenMetadata）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| L5.1 | 资产摄取 | OpenMetadata 配置 Doris 连接，摄取 `ods_ep` 成功（表/列元数据入库） |
| L5.2 | 资产可查 | OpenMetadata UI 中 EP 表 schema、列清单与源一致（抽样比对） |
| L5.3 | 血缘呈现 | Superset 摄取连通后图表→数据集→ods_ep 表血缘链可见（dbt 摄取如可行则质量层一并呈现） |
| L5.4 | 入口留证 | 经网关 8445 访问成功，截图留证；门户血缘页保持静态演示的边界如实标注 |

## L6. Superset 图表场景（映射蓝图 12.1「图表能追到指标口径和源数据集」）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| L6.1 | 数据源接入 | Superset 配 Doris 连接（只读账号，MySQL 协议 9030），数据集建 `ods_ep.ep_mz_cfzb` |
| L6.2 | 图表×3 | ①开方量趋势（KFRQ 日粒度）②开方科室 TOP10（JZKSMC）③处方平台状态分布（CFPTZT） |
| L6.3 | 数值对账 | 任选 2 个维度：图表聚合值 == Doris SQL 直查值（误差 0） |
| L6.4 | 访问留证 | 网关 8444 登录可用，图表截图留证 |

## M. 蓝图 §12 覆盖映射（诚实边界）

| 蓝图条目 | 本轮 |
| --- | --- |
| 12.1 数据库全量后切换增量/CDC，记录数可核对 | ✅（上轮全量 + 本轮前置机增量；CDC 出不可用结论） |
| 12.1 质量规则失败生成工单，修复后重跑并关闭 | ✅ L3 |
| 12.1 MPI 确定匹配/可能匹配/拒绝…全流程 | ◐ L4（Doris 层匹配实验；合并/拆分/撤销 UI 不在本轮） |
| 12.1 Superset 图表追到口径和源数据集 | ✅ L6 |
| 12.2 中心断网、前置节点重启、恢复补传 | ✅ L2（20 分钟缩比，非 72h） |
| 12.2 SeaTunnel 任务失败后从检查点恢复 | ◐ 复用上轮 retry/对账证据 + 本轮 L2.4 |
| 12.2 源 schema 增删列/主键变化影响面 | ✗ 不在本轮（列明） |
| 12.2 对象存储/OpenMetadata/Superset 分别不可用降级 | ✗ 不在本轮（列明） |
| 12.3 边界患者样本（新生儿/急诊未知/简繁体…） | ✗ 不在本轮（L4.4 列明） |
| 12.4 合同指标（72h 缓存、2 倍补传、压测） | ◐ 机制缩比验证（L2），容量指标不声称 |

## 附录：清理与回滚

- 合成数据：`DELETE ... WHERE ID >= 910000000`（主/明细两张），删除前后行数留证。
- 网络还原：iptables 规则清理（恢复 platform-net→DM 直连，上轮直连链路可继续作为对照）。
- 组件回滚：SeaTunnel 回 `2.3.13-dataos.3`、quality-runner/控制面回旧 tag；`ods_ep` 增量表与中转桶可单独清理，不影响质量库与既有 `ep_mz_cfzb/ep_mz_ypcfmx` 对账表。
- MiNiFi：新 flow 加载前备份原 conf 目录；实验后可恢复 data-ops 原 flow。
- 安全口径沿用上轮：口令仅存凭据服务/开发机 `.env`；汇报只对账行数与结构列，合成行患者字段全部使用模拟值，不含真实 PHI。
