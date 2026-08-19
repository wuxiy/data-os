# MPI 技术方案审核意见 与 G3 实施方案 — 2026-08-19（v2）

审核对象：《Data-OS MPI 主索引技术方案 v1.1（Splink 增强版）》。结论：**方向采纳，架构修正 3 处，范围裁剪后作为 G3 基线**。

> v2 变更（2026-08-19 二次评审）：服务形态经重估由「内嵌 control-plane」改为**独立服务 `services/mpi-service`**——初评过度强调基建复用、低估了领域自包含性与安全边界价值；重估四论据（演进节奏分离、安全边界、quality-runner 先例、资源画像）经用户确认采纳（方案 A）。存储拆分相应调整为 MPI 服务独占 schema。修正 3、裁剪表与实施步骤已同步更新。

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

**修正 2（v2 重估后定案）：MPI 建为独立服务 `services/mpi-service`。**
初评建议内嵌 control-plane，重估后推翻，理由记录如下：

- **领域自包含**：MPI 域（person/link/review/audit + 批量匹配）与 control-plane 现有域（采集运行、治理闭环、凭据）几乎无共享事务——消费 Doris 的 ods_ep、对外暴露 REST，耦合面窄，「必须内嵌」的领域论据不成立；
- **演进节奏分离**：V2-V4 将带来概率模型、mpi-lab、ML 依赖与独立发布节奏；内嵌意味着每次 MPI 迭代都要重发 control-plane，把身份匹配的变更爆炸半径扩大到采集/治理/凭据全部 API；
- **安全边界**：患者身份是平台最高敏数据，独立服务 = 独立凭据域、独占数据库账号、独立网络策略与审计管线，PHI/PII 影响面物理隔离；
- **先例模式**：quality-runner 已趟通「控制面 + 独立执行服务」（OIDC 服务间鉴权、HTTP 契约、独立容器与流水线），MPI 照此模式的边际成本一次性且有界（骨架复制约 1 天级 + 部署单元半天级）；
- **资源画像**：批量 rebuild 是 CPU/内存密集批处理，与 control-plane 的延迟敏感 OLTP 画像分离。

代价（已接受）：+1 服务/镜像/流水线；鉴权与租户骨架复制（暂不抽共享库，第三个 JVM 服务出现时再抽）；nginx 增加一条路由；密钥配置面多一处。

**修正 3：存储拆分——事务态在 PostgreSQL，批处理态在 Doris，且两处均由 MPI 服务独占。**
文档把 9 张表全放 Doris。Doris 无事务，`mpi_review_task`（复核状态机）、`mpi_person_link`（valid_from/valid_to 版本链）、`mpi_audit_event`（不可变审计）这类事务与一致性敏感的表放 Doris 是用短处。修正拆分：
- **PostgreSQL 独立 schema `data_os_mpi`**（可复用同一 PG 实例；Flyway 由 mpi-service 持有）：`mpi_person`、`mpi_person_link`、`mpi_review_task`、`mpi_audit_event`、`mpi_rule_version`；
- **Doris `dataos_mpi` 库**：`mpi_source_identity`（UNIQUE KEY 去重）、`mpi_candidate_pair`、`mpi_match_result`——批量 Blocking/匹配是 Doris 长处；
- 数据库账号独占：MPI 服务持有 `data_os_mpi` schema 与 `dataos_mpi` 库的专用账号，control-plane 不直连 MPI 数据；
- `mpi_label`（V3）、`mpi_model_registry`（V2）、`mpi_term_frequency`（V2）延后创建，G3 不建空表。

### 3. 范围裁剪与延后（G3 只做 V1 的演示档子集）

| 裁剪项 | G3 处置 | 恢复版本 |
| --- | --- | --- |
| 概率模型 / Comparison 权重 / TF / EM / Round-Robin | 不做；G3 只保留 ComparisonResult 的 evidence 结构为将来留位 | V2 |
| mpi-lab（Splink/DuckDB） | 不建目录 | V2 |
| 监督 ML / Label Store / 主动采样 | 不做；人工复核结果先落 `mpi_audit_event`，V3 再建 label 表回填 | V3 |
| Champion/Challenger/Shadow/Drift | 不做 | V4 |
| FHIR `$match` / HapiFhirMdmEngine 实现 | SPI 接口定义 + 文档说明，不实现 | 后续 |
| 17 个 Maven 子模块 | 降为 mpi-service 单工程内的**包结构**（normalizer/candidate/matcher/decision/review 分包） | 规模化时 |
| Review Center「历史就诊摘要」 | G3 展示身份字段对比 + 匹配证据 + 历史合并/拆分记录，不聚合就诊时间线 | G6+ |
| `mpi_person_id` 回写 DWD（dwd_patient_with_mpi） | G3 只回写 Doris 侧 `mpi_source_identity.mpi_person_id` 列，DWD 建模不在本轮 | G5+ |

### 4. 数据现实核对（EP 演示数据 vs 文档规则集）

文档规则集以「身份证/医保号/出生日期」为强字段设计，但 **EP 演示数据没有这三类字段**（`EP_MZ_CFZB` 实有：KH 卡号、PATIENT_ID、HZXM 姓名、HZXB 性别、HZNL 年龄字符串、LXFS 联系方式、YLJGDM 机构）。因此：

- M1（身份证）/M2（医保）规则 **无法在 EP 数据上触发**——代码与表结构按文档实现（哈希字段就位），演示验收用 EP 适配规则（见 G3 方案规则集）；
- 出生日期缺失 → Blocking B5（姓名+出生日期）、birth_* 特征、月日颠倒检测在 EP 上不可用；**HZNL 年龄仅作展示证据、不进规则**（年龄随时间漂移，不是稳定身份属性）；
- 卡号复用是 EP 真实存在的数据形态（探针实证：KH 4413\*\*\*\* 存在同卡不同名），正好是 P1 规则（同卡+冲突→POSSIBLE）的天然验收样本；
- 身份证哈希加盐的盐值从环境注入（`DATAOS_MPI_HASH_SALT`，仅存开发机 `.env`），EP 无数据时字段空置。

### 5. 文档缺陷（下次修订时顺手改）

1. 章节编号重复：两个「2.2」（Splink 选型结论 / 核心原则），§5 子节用了二级标题；
2. `mpi_person_link.link_status` 枚举未定义（本方案补齐：ACTIVE / REJECTED / MERGED / SPLIT / EXPIRED）；
3. §7.2 B4「医院+卡号」blocking 建议补一句「不同 blocking 规则产出的候选对需按 pair 去重」；
4. 附录 B 第 20 项（DuckDB+Splink 千万级压测）建议标注为上线容量门而非 G 项任务。

---

## 二、G3 实施方案（V1 确定性 MPI · 演示档 · 独立服务）

### 0. 定位与边界

**目标**：以 EP 真实数据建立可信的确定性 MPI 基线，把门户「主索引审核」页从静态演示切换为真实工作台，形成「装载→候选→三态→复核→合并/拆分→审计」完整闭环；MPI 作为独立服务上线（V2-V4 无需二次拆分）。

**不做**：概率模型、ML、mpi-lab、FHIR $match、就诊时间线（见裁剪表）。

**术语登记**（进 CONTEXT.md，先定名再进代码）：Golden Person（黄金人）、Source Identity（源身份）、Hard Conflict（硬冲突）、Candidate Pair（候选对）、Blocking（候选召回）、Review（人工复核）。

### 1. 架构落点

```
prototype MpiReviewPage（接真，保留 runtimeMode 演示开关语义）
        │  /api/v1/mpi/*（nginx 直路由，不经控制面）
        ▼
services/mpi-service（新，Spring Boot 3 / Java 21，quality-runner 服务模式）
  ├── 鉴权/租户：OIDC resource server 配置复制自 control-plane（dev AUTH_MODE=DISABLED 对齐）
  ├── MpiNormalizer          标准化（姓名 trim/全半角/简繁占位、性别归一、卡号归一）
  ├── MpiBlockingService     Doris SQL 候选生成（B3/B4/B6'）
  ├── MpiRuleMatcher         确定性规则集 + Hard Constraint（rule_version 管理）
  ├── MpiDecisionService     AUTO_MATCH / REVIEW / NO_MATCH 三态落库
  ├── MpiPersonService       Golden Person 建立、Merge / Split
  ├── MpiReviewService       复核任务领取、决策落 Audit
  ├── MpiEngine SPI          接口定义（DataOsHybridMpiEngine=默认实现；HapiFhirMdmEngine 仅声明）
  └── MpiAuditRepository     审计事件

存储（MPI 服务独占账号）：
  PostgreSQL schema data_os_mpi（mpi-service 的 Flyway）：
      mpi_person、mpi_person_link、mpi_review_task、mpi_audit_event、mpi_rule_version
  Doris dataos_mpi 库：
      mpi_source_identity(UNIQUE KEY)、mpi_candidate_pair、mpi_match_result

边界：control-plane 不实现任何 MPI 逻辑、不直连 MPI 数据；
     门户只经 nginx 调 MPI 服务；未来 rebuild 长任务编排（V2+ 视规模）经既有
     HTTP executor 契约接入 ExternalRunLifecycle，不新建耦合。
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

API（mpi-service 持有，鉴权/租户语义与 control-plane 一致）：
`POST /api/v1/mpi/rebuild`（按机构/表触发装载+匹配，同步返回统计）、
`GET /api/v1/mpi/candidates?status=REVIEW`、`GET /api/v1/mpi/matches/{pairId}/explain`、
`GET /api/v1/mpi/persons/{id}`、`POST /api/v1/mpi/links/{linkId}/decision`、
`POST /api/v1/mpi/persons/merge`、`POST /api/v1/mpi/persons/{id}/split`、
`GET /api/v1/mpi/metrics`、`GET /actuator/health`。

### 4. 门户（MpiReviewPage 真实化）

路由层把 `/api/v1/mpi/*` 指向 mpi-service（nginx location；dev 与生产同构）；候选列表（分页/状态筛选）→ 双侧身份对比 → 匹配证据 → 操作（确认同人/确认不同人/暂缓/合并/拆分）→ 留痕展示；演示模式开关语义沿用 runtimeMode，真数据不可用时如实空态。

### 5. 实施步骤（每步全绿独立提交）

| 步骤 | 内容 | 验证 |
| --- | --- | --- |
| G3.0 | CONTEXT.md 登记术语；方案文档入库（本文件） | 评审 |
| G3.1 | **服务脚手架**：`services/mpi-service` 工程（Spring Boot 3/Java 21）、OIDC/租户配置、actuator 健康检查、Dockerfile、dev compose 接入、nginx `/api/v1/mpi/` 路由 | 容器 healthy；门户代理链路通（匿名鉴权口径与 control-plane 一致） |
| G3.2 | 存储：Doris `dataos_mpi` 三表 + PG schema `data_os_mpi`（服务内 Flyway V1）+ 独占账号（沿用 B1 三重授权模式） | DDL/迁移留证；迁移单测 |
| G3.3 | Normalizer + 装载管道（幂等）+ Blocking SQL + 候选去重 | 单测 + EP 全量装载对账 |
| G3.4 | 规则集 + Hard Constraint + Decision + Golden Person/Link + Audit | 单测（每条规则正反例、H-ep1/2） |
| G3.5 | Review/Merge/Split 服务 + REST API + metrics | 单测 + API 契约测试（幂等、审计不可变） |
| G3.6 | 门户接真 + 浏览器验证截图 | qa 脚本 + 交互 smoke 全绿 |
| G3.7 | EP 端到端验收（下表）+ 报告 | 逐项留证 |

### 6. G3 验收清单（演示档）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| 1 | 服务上线 | mpi-service 容器 healthy；门户经 nginx 调通全部 API；鉴权/租户口径与 control-plane 一致（生产 OIDC 独立 audience 预留） |
| 2 | 身份装载 | `ep_mz_cfzb` 去重身份全量入 `mpi_source_identity`，行数与 Doris 直查一致；重跑幂等 |
| 3 | 候选生成 | 三条 Blocking 均产出候选且 pair 去重；输出 Reduction Ratio / 每身份候选数统计 |
| 4 | 三态实例 | AUTO_MATCH / REVIEW / NO_MATCH 三态各存在真实样本；卡号复用对（KH 4413\*\*\*\*）落 REVIEW 而非 AUTO（误合并拦截实证） |
| 5 | 复核闭环 | 门户完成：确认同人→合并（person 合一、link 决策源=MANUAL）；确认不同人→同对不再自动候选（H-ep1 实证）；拆分→恢复且可再操作 |
| 6 | 审计 | 每次 Merge/Split/决策记录 operator/时间/前后状态/理由/规则版本 |
| 7 | Explain | 任一 pair 的 `/explain` 返回命中规则与逐字段证据 |
| 8 | 指标 | `/metrics` 输出五项指标；门户指标卡与 API 一致 |
| 9 | 回归 | mpi-service 全量测试绿；上一轮 EP 采集/质量链路零回归；control-plane 零 MPI 代码；`ep_mz_cfzb` 原表零修改 |
| 10 | 安全 | 明文证件/联系方式不落审计与日志；盐值仅存 `.env`；汇报不含 PHI |

### 7. 延后清单（防丢）

V2：Comparison/权重、TF、EM、mpi-lab(Splink/DuckDB)、Java FS Runtime、模型注册表、双阈值；V3：Label Store、监督 ML、跨院 Holdout；V4：Champion/Challenger、Shadow、Drift；后续：FHIR `$match`、HapiFhirMdmEngine 实现、rebuild 长任务编排接入 ExternalRunLifecycle、DWD 回写、就诊时间线聚合、三 JVM 服务出现时抽取共享鉴权库。

### 8. 回滚

mpi-service 容器与镜像独立，停服/删容器即回滚（nginx 路由摘除）；Doris `dataos_mpi` 库可独立 DROP；PG `data_os_mpi` schema 独立 DROP——均不影响 control-plane 的 `data_os` schema、EP 采集对账表与既有链路。
