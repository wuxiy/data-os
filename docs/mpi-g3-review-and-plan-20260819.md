# MPI 技术方案审核意见 与 G3 实施方案 — 2026-08-19

审核对象：《Data-OS MPI 主索引技术方案 v1.1（Splink 增强版）》。结论先行：**方向采纳，架构修正 3 处，范围裁剪后作为 G3 基线**。本文件前半为审核意见（分级：采纳 / 修正 / 裁剪延后 / 文档缺陷），后半为可直接执行的 G3 实施方案。

---

## 一、审核意见

### 1. 采纳（无需改动的设计决策）

| 决策 | 采纳理由 |
| --- | --- |
| Splink 限定在 Learning Plane（训练/评估/参考实现），生产不引入 Python/Spark 在线依赖 | 与仓库「组件通过稳定 Adapter/BFF 接入」纪律一致；探针已实证 Python 运行时不受控面约束的代价 |
| Hard Constraint 永远高于模型分数；弱标识（卡号/手机号/姓名）不得单独硬合并 | 与蓝图 8.1「错误合并风险高于漏合并」一致，且被 HAPI 探针实证（同卡不同人被 EID 硬合并） |
| 三段式决策 + 双阈值（不用单阈值 0.5） | 医疗 MPI 标准实践 |
| Cluster Guard 拒绝朴素连通分量聚类（A≈B、B≈C 不代表 A==C） | 正确；G3 规模下问题不显，但约束先立住 |
| HAPI FHIR MDM 不作主引擎、保留 MpiEngine SPI 可切换 | 与探针结论（阻断级疑点：姓名候选搜索未生效、split 未注册）一致 |
| V1 确定性 → V2 概率 → V3 监督 ML → V4 受控进化的迭代顺序 | 演示导向下 V1 即 G3，顺序合理 |
| 敏感字段加盐哈希、Merge/Split 全量审计、规则/模型版本化 | 安全与审计基线，直接采纳 |

### 2. 修正（架构落地必须改的三处）

**修正 1：命名冲突——文档的 G3/G4 与门户迭代 G 编号相撞。**
文档 §11.3 写「Fellegi-Sunter 作为 G4 主概率匹配器」、§29 用 V1/G3、V2/G4 指代 MPI 内部迭代；而项目当前语境里 **G3=MPI 门户迭代、G4=分析页迭代**。两套 G 编号并存必然混淆。修正：文档统一改用 **V1-V4**（V1 确定性、V2 概率+Splink Lab、V3 监督 ML、V4 受控进化）；本方案中的「G3」恒指门户迭代的 MPI 任务 = 文档的 **V1**。

**修正 2：MPI 不建独立服务——落点为 control-plane 内嵌模块。**
文档 §25.1 建议 MPI Service 为独立 Spring Boot 服务。仓库现实：control-plane 是唯一 Java 服务（已拥有凭据、租户、审计、通知、Flyway 全部基础设施），为 G3 新起一个服务意味着重复解决鉴权/迁移/部署/观测，违背当前阶段「不加无必要在线服务」原则（文档自己在 §25.4 也这么主张）。修正：G3 的 MPI 生产代码全部落在 `services/control-plane` 的 `mpi/` 包内；「独立 mpi-service」留作规模化后的抽取选项（代码按包边界组织，保持可迁移性）。

**修正 3：存储拆分——事务态在 PostgreSQL，批处理态在 Doris。**
文档把 9 张表全放 Doris。Doris 无事务，`mpi_review_task`（复核状态机、并发领取）、`mpi_person_link`（valid_from/valid_to 版本链）、`mpi_audit_event`（不可变审计）这类**事务与一致性敏感**的表放 Doris 是用短处。修正拆分：
- **PostgreSQL（`data_os` schema，Flyway V10 起）**：`mpi_person`、`mpi_person_link`、`mpi_review_task`、`mpi_audit_event`、`mpi_rule_version`——复核工作流与审计和治理问题闭环（governance_issues）同构，复用现有模式；
- **Doris（新库 `dataos_mpi`）**：`mpi_source_identity`（标准化身份快照，UNIQUE KEY 去重）、`mpi_candidate_pair`（Blocking 批量产物）、`mpi_match_result`（批量匹配结果）——这是 Doris 的长处（大批量 SQL join/聚合）；
- `mpi_label`（V3）、`mpi_model_registry`（V2）、`mpi_term_frequency`（V2）延后创建，G3 不建空表。

### 3. 范围裁剪与延后（G3 只做 V1 的演示档子集）

| 裁剪项 | G3 处置 | 恢复版本 |
| --- | --- | --- |
| 概率模型 / Comparison 权重 / TF / EM / Round-Robin | 不做；G3 只保留 ComparisonResult 的 evidence 结构为将来留位 | V2 |
| mpi-lab（Splink/DuckDB） | 不建目录 | V2 |
| 监督 ML / Label Store / 主动采样 | 不做；人工复核结果先落 `mpi_audit_event`，V3 再建 label 表回填 | V3 |
| Champion/Challenger/Shadow/Drift | 不做 | V4 |
| FHIR `$match` / HapiFhirMdmEngine 实现 | SPI 接口定义 + 文档说明，不实现 | 后续 |
| 模块化（17 个 Maven 子模块） | 降为 control-plane 内**包结构**（`mpi/` 下按 normalizer/candidate/matcher/decision/review 分包） | 规模化时 |
| Review Center「历史就诊摘要」 | G3 展示身份字段对比 + 匹配证据 + 历史合并/拆分记录，不聚合就诊时间线 | G6+ |
| `mpi_person_id` 回写 DWD（dwd_patient_with_mpi） | G3 只回写 Doris 侧 `mpi_source_identity.mpi_person_id` 列，DWD 建模不在本轮 | G5+ |

### 4. 数据现实核对（EP 演示数据 vs 文档规则集）

文档规则集以「身份证/医保号/出生日期」为强字段设计，但 **EP 演示数据没有这三类字段**（`EP_MZ_CFZB` 实有：KH 卡号、PATIENT_ID、HZXM 姓名、HZXB 性别、HZNL 年龄字符串、LXFS 联系方式、YLJGDM 机构）。因此：

- M1（身份证）/M2（医保）规则 **无法在 EP 数据上触发**——代码与表结构按文档实现（哈希字段就位），演示验收用 EP 适配规则（见 G3 方案规则集）；
- 出生日期缺失 → Blocking B5（姓名+出生日期）、birth_* 特征、月日颠倒检测在 EP 上不可用；**HZNL 年龄仅作展示证据、不进规则**（年龄随时间漂移，不是稳定身份属性）；
- 卡号复用是 EP 真实存在的数据形态（探针实证：KH 4413**** 存在同卡不同名），正好是 P1 规则（同卡+冲突→POSSIBLE）的天然验收样本；
- 身份证哈希加盐的盐值从环境注入（`DATAOS_MPI_HASH_SALT`，仅存开发机 `.env`），EP 无数据时字段空置。

### 5. 文档缺陷（下次修订时顺手改）

1. 章节编号重复：两个「2.2」（Splink 选型结论 / 核心原则），§5 子节用了二级标题；
2. `mpi_person_link.link_status` 枚举未定义（本方案补齐：ACTIVE / REJECTED / MERGED / SPLIT / EXPIRED）；
3. §7.2 B4「医院+卡号」blocking 建议补一句「不同 blocking 规则产出的候选对需按 pair 去重」；
4. 附录 B 第 20 项（DuckDB+Splink 千万级压测）建议标注为上线容量门而非 G 项任务。

---

## 二、G3 实施方案（V1 确定性 MPI · 演示档）

### 0. 定位与边界

**目标**：以 EP 真实数据建立可信的确定性 MPI 基线，并把门户「主索引审核」页从静态演示切换为真实工作台，形成「装载→候选→三态→复核→合并/拆分→审计」的完整闭环。

**不做**：概率模型、ML、 mpi-lab、FHIR $match、独立服务、就诊时间线（见审核·裁剪表）。

**术语登记**（进 CONTEXT.md，先定名再进代码）：Golden Person（黄金人）、Source Identity（源身份）、Hard Conflict（硬冲突）、Candidate Pair（候选对）、Blocking（候选召回）、Review（人工复核）。

### 1. 架构落点

```
prototype MpiReviewPage（接真，保留 runtimeMode 演示开关语义）
        │ /api/v1/mpi/*
        ▼
control-plane  mpi/ 包
  ├── MpiNormalizer          标准化（姓名 trim/全半角/简繁占位、性别归一、卡号归一）
  ├── MpiBlockingService     Doris SQL 候选生成（B3/B4/B6'）
  ├── MpiRuleMatcher         确定性规则集 + Hard Constraint（rule_version 管理）
  ├── MpiDecisionService     AUTO_MATCH / REVIEW / NO_MATCH 三态落库
  ├── MpiPersonService       Golden Person 建立、Merge / Split
  ├── MpiReviewService       复核任务领取、决策落 Audit
  ├── MpiEngine SPI          接口定义（DataOsHybridMpiEngine=默认实现；HapiFhirMdmEngine 仅声明）
  └── MpiAuditRepository     审计事件（复用治理审计模式）

存储：
  Doris dataos_mpi 库：mpi_source_identity(UNIQUE KEY)、mpi_candidate_pair、mpi_match_result
  PostgreSQL data_os（Flyway V10__mpi.sql）：mpi_person、mpi_person_link、
      mpi_review_task、mpi_audit_event、mpi_rule_version
```

### 2. EP 适配规则集（rule_version=v1，代码内置常量 + 表留版本记录）

| 规则 | 条件（标准化后） | 结果 |
| --- | --- | --- |
| M-ep1 | 同机构 + PATIENT_ID 相同 + 姓名相同 + 性别相同 | AUTO_MATCH |
| M-ep2 | 同机构 + 卡号相同 + 姓名相同 + 性别相同 | AUTO_MATCH |
| P-ep1 | 同机构 + 卡号相同 + （姓名或性别不同） | REVIEW（卡号复用） |
| P-ep2 | 姓名相同 + 性别相同 + 无卡号/卡号互异 | REVIEW |
| H-ep1 | 历史人工确认 NO_MATCH 的身份对再次候选 | HARD_CONFLICT → NO_MATCH |
| H-ep2 | 历史人工 Split 的身份对再次候选 | HARD_CONFLICT → NO_MATCH |

Blocking（Doris SQL，候选对去重）：B3=机构+PATIENT_ID；B4=机构+卡号；B6'=姓名+性别（EP 无出生日期的替代召回）。年龄 HZNL 仅入 evidence 展示。

### 3. 数据流与 API

```
ods_ep.ep_mz_cfzb ──装载(标准化)──▶ Doris mpi_source_identity（幂等：UNIQUE KEY 覆盖）
   └─ mpi_person_id 回写列
Blocking SQL ─▶ mpi_candidate_pair ─▶ 规则匹配 ─▶ mpi_match_result（三态+evidence）
   ├─ AUTO_MATCH → 自动建/并入 Golden Person（person_link 决策源=RULE）
   └─ REVIEW     → PG mpi_review_task（门户工作台领取）
人工：确认同人→Merge；确认不同人→NO_MATCH 标记（H-ep1 生效）；Split→恢复独立 Person
```

API（全部挂 control-plane，鉴权/租户复用现有机制）：
`POST /api/v1/mpi/rebuild`（按机构/表触发装载+匹配，同步返回统计）、
`GET /api/v1/mpi/candidates?status=REVIEW`、`GET /api/v1/mpi/matches/{pairId}/explain`、
`GET /api/v1/mpi/persons/{id}`、`POST /api/v1/mpi/links/{linkId}/decision`、
`POST /api/v1/mpi/persons/merge`、`POST /api/v1/mpi/persons/{id}/split`、
`GET /api/v1/mpi/metrics`（覆盖数/AUTO 数/复核率/合并数/拆分数）。

### 4. 门户（MpiReviewPage 真实化）

候选列表（分页/状态筛选）→ 双侧身份对比（机构/系统/姓名/性别/卡号/PATIENT_ID/年龄）→ 匹配证据（命中规则、evidence）→ 操作（确认同人 / 确认不同人 / 暂缓 / 合并 / 拆分）→ 操作留痕展示；演示模式开关语义沿用 runtimeMode，真数据不可用时如实空态。

### 5. 实施步骤（每步全绿独立提交）

| 步骤 | 内容 | 验证 |
| --- | --- | --- |
| G3.0 | CONTEXT.md 登记术语；方案文档入库 | 评审 |
| G3.1 | Doris `dataos_mpi` 三表 + PG Flyway V10 五表 + 授权（沿用 B1 三重授权模式） | DDL 留证；迁移单测 |
| G3.2 | Normalizer + 装载管道（ods_ep→source_identity，幂等）+ Blocking SQL + 候选去重 | 单测 + EP 全量装载对账（去重身份数 vs SQL 直查） |
| G3.3 | 规则集 + Hard Constraint + Decision + Golden Person/Link + Audit | 单测（每条规则正反例、H-ep1/2） |
| G3.4 | Review/Merge/Split 服务 + REST API + metrics | 单测 + API 契约测试（幂等、审计不可变） |
| G3.5 | 门户接真 + 浏览器验证截图 | qa 脚本 + 交互 smoke 全绿 |
| G3.6 | EP 端到端验收（下表）+ 报告 | 逐项留证 |

### 6. G3 验收清单（演示档）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| 1 | 身份装载 | `ep_mz_cfzb` 去重身份全量入 `mpi_source_identity`，行数与 Doris 直查一致；重跑幂等（行数不增） |
| 2 | 候选生成 | 三条 Blocking 均产出候选且 pair 去重；输出 Reduction Ratio / 每身份候选数统计 |
| 3 | 三态实例 | AUTO_MATCH / REVIEW / NO_MATCH 三态各存在真实样本；卡号复用对（KH 4413****）落 REVIEW 而非 AUTO（误合并拦截实证） |
| 4 | 复核闭环 | 门户完成：确认同人→合并（person 合一、link 决策源=MANUAL）；确认不同人→同对不再自动候选（H-ep1 实证）；拆分→恢复且可再操作 |
| 5 | 审计 | 每次 Merge/Split/决策记录 operator/时间/前后状态/理由/规则版本 |
| 6 | Explain | 任一 pair 的 `/explain` 返回命中规则与逐字段证据 |
| 7 | 指标 | `/metrics` 输出五项指标；门户指标卡与 API 一致 |
| 8 | 回归 | control-plane 全量测试绿；上一轮 EP 采集/质量链路零回归；`ep_mz_cfzb` 原表零修改 |
| 9 | 安全 | 明文证件/联系方式不落 PG 审计与日志；盐值仅存 `.env`；汇报不含 PHI |

### 7. 延后清单（防丢）

V2：Comparison/权重、TF、EM、mpi-lab(Splink/DuckDB)、Java FS Runtime、模型注册表、双阈值；V3：Label Store、监督 ML、跨院 Holdout；V4：Champion/Challenger、Shadow、Drift；后续：FHIR `$match`、HapiFhirMdmEngine 实现、独立 mpi-service 评估、DWD 回写、就诊时间线聚合。

### 8. 回滚

控制面镜像回退旧 tag；Doris `dataos_mpi` 库可独立 DROP；PG V10 表为新增表，`DROP TABLE` 即回滚，不影响既有 `data_os` 表与 EP 采集对账表。
