# AI Ready 迭代计划（G8+）

> 日期：2026-08-26
> 状态：规划稿（待评审确认后执行）
> 前置文档：`docs/architecture/ai-ready-data.md`（架构方案 v1.0，本文按 Gate 方式拆解其实施节奏）
> 对齐原则：延续 G0–G7 的 Gate 式迭代节奏——每个 Gate 有明确 Goal / Scope / 验收清单 / 边界与回滚 / 延后清单，验收证据落库后提交推送

---

## 一、现状盘点（截至 2026-08-26）

### 1.1 已完成的迭代序列

| Gate | 主题 | 状态 | 验收证据 |
|---|---|---|---|
| Gate 0 | 安全与生产基础（OIDC/凭据/SSRF/Flyway/CI） | ✅ 完成 | `docs/validation/quality-hardening-20260805.md` 等 |
| Gate 1 | 远程部署 + DolphinScheduler 调度器接入 | ✅ 完成 | `docs/validation/gate1-dolphinscheduler-20260807.md` |
| Gate 2 | 自动化 + 血缘门户 | ✅ 完成 | `docs/lineage-g1-g2-review-and-plan-20260820.md` |
| Gate 3 | MPI 患者主索引独立服务 | ✅ 完成 | `docs/validation/gate-mpi-g3-20260819.md` |
| Gate 4 | Superset 嵌入式分析 + 门户看板 | ✅ 完成 | `docs/validation/gate-analytics-g4-20260820.md` |
| Gate 5 | 前置机边缘链路（MiNiFi + RustFS 中转到 Doris） | ✅ 完成 | `docs/validation/gate-hospital-edge-g5-20260820.md` |
| Gate 6 | OpenMetadata 资产目录 + 三库对账 | ✅ 完成 | `docs/validation/gate-om-assets-g6-20260821.md` |
| Gate 7 | dbt 血缘 + 质量测试资产化（列级血缘、TestCase） | ✅ 完成 | `docs/validation/gate-dbt-lineage-g7-20260822.md` |

最后提交：`a800860`（2026-08-22），工作区干净（仅 `.gitignore` 未提交修改）。

### 1.2 当前能力基线

**Trusted Data Foundation 已经扎实：**

- 采集：SeaTunnel / MiNiFi 前置机边缘链 / Debezium / JDBC（含达梦）/ S3File 中转到 Doris 边缘增量表（UNIQUE KEY 幂等）
- 存储与建模：Doris ODS→DWD→DWS→ADS + dbt
- 治理：质量规则引擎（quality-runner，dbt test 引擎已可扩展）、复检闭环、通知发件箱、SLA 扫描
- 身份：MPI 独立服务（源身份/黄金人/候选对/硬冲突/复核，Production/Learning Plane 分离）
- 元数据与血缘：OpenMetadata 单一持有（资产/血缘/TestCase/Glossary），OpenLineage 语义，血缘 BFF 只读适配
- 安全：OIDC + 租户 + 凭据密文 + SSRF 防护 + 审计，生产 fail-closed
- 运维：platformctl（preflight/install/status/smoke/backup/restore/restart）、CI（测试/构建/secret scan/SBOM/镜像门禁）

**尚未具备（AI Ready 缺口）：**

- ❌ 无一等领域的 AI Data Product（Manifest / Version / Lifecycle）
- ❌ 无 AI Readiness Assessment（6C / Workload Profile / Requirement）
- ❌ 无 AI 数据集加工链（RAG Corpus / Chunk / 文档解析 / 数据飞轮反馈）
- ❌ 无 AI 应用评测（RAG Eval / Agent Eval）与评测结果回写
- ❌ 门户无 AI Data 工作台

> 结论：底座（Trusted Data + 治理 + 血缘 + 安全）已经可以支撑 AI Data Plane，切入时机合适。AI Ready 不是推倒重来，而是在既有 Trusted Data Foundation 之上新增一条独立 Plane，并复用控制面、质量执行器、OpenMetadata、门户与部署骨架。
---

## 二、AI Ready 架构决策摘要（详见架构文档）

1. AI Ready = Data Quality × Semantic Context × AI Consumability × Workload Fit × Governance × Evaluation
2. 6C 模型：Clean / Contextual / Consumable / Current / Correlated / Compliant
3. Workload Profile 决定 Requirement + Weight + Threshold：首批 `medical-rag` / `medical-training`
4. AI Data Product 一级对象，生命周期 DRAFT → CURATED → ASSESSED → CERTIFIED → SERVING → DEPRECATED
5. Data-Juicer = AI Dataset Curation Engine；Docling = 文档解析；Label Studio = 人工标注
6. OpenMetadata 继续作为 Metadata / Semantic / Governance Source of Truth；OpenLineage 统一血缘事件
7. Certification Gate：Score < 0.70 FAIL；0.70–0.85 REVIEW；≥ 0.85 进认证候选；Critical FAIL 一票否决，自动检查 + 人工审批
8. Production Plane / Learning Plane 分离：AI 输出不自动改生产治理规则
9. 新增 `ai-ready-service`（评估引擎）；Recipe 化、版本化、可复现；产物落对象存储/RustFS

---

## 三、迭代规划总览

```text
G8  AI Ready 域基础      （Model / Manifest / Lifecycle / API / 门户占位）
G9  AI Ready Engine MVP  （ai-ready-service + Profile + Requirement + Adapter + 首批评估）
G10 RAG 数据集工厂        （Docling + Data-Juicer + Recipe + 第一条 RAG Corpus）
G11 评测与认证闭环        （RAG Eval + Certification Gate + 回写 OpenMetadata）
G12 数据飞轮与门户收口    （Feedback Loop + AI Data 工作台 + Dashboard）
```

依赖关系：

```text
G8 ──► G9 ──► G10 ──► G11 ──► G12
       ▲        ▲        ▲
       │        └────────┤
       └──────────────────┘
(全部叠加在 G0–G7 已交付底座之上；G10 需要 G9 的评估能力，G11 需要 G10 的产物)
```

预估节奏：延续每 Gate 2–3 天，约 2–3 周完成 G8–G12。

---

## 四、Gate 详情

### Gate 8：AI Ready 域基础

#### Goal

把 AI Data Product 作为一等域对象落地到控制面与门户：定义 Manifest / Version / Lifecycle，打通创建—构建占位—状态机，但不实现真实评估引擎。

#### Scope

- CONTEXT.md 新增术语：`AI Data Product`、`AI Ready`、`AI Ready Engine`、`Workload Profile`、`Manifest`、`Certification`、`Dataset Version`
- control-plane 新增 Flyway 迁移：
  - `ai_data_product`（name/type/owner/source/workload/current_version/lifecycle_status）
  - `ai_data_product_version`（semver、snapshot、recipe_ref、git_commit、readiness_score、评估 JSON、唯一性约束：产品 + 版本号）
  - `ai_recipe`（recipe 声明清单，Git 管理为主，库表仅登记已注册 recipe）
- API（复用 OIDC/租户/审计基建）：
  - `POST /api/v1/ai-data-products`、`GET .../{id}`、`GET /api/v1/ai-data-products`（列表）
  - `POST /api/v1/ai-data-products/{id}/build`（先行登记运行，评估引擎未就绪时明确返回"引擎未装配"）
  - 生命周期流转接口：`POST .../{id}/lifecycle`（DRAFT→CURATED 等，状态机校验）
- 前端：门户新增 `AI Data` 导航与产品列表/详情页（真实 API，未装配能力显示明确空态——延续"不把演示状态当真实业务事实"原则）

#### 验收清单

- [ ] AI Data Product 生命周期状态机契约测试（非法流转被拒）
- [ ] 版本号唯一性 + 产品版本历史查询
- [ ] API 鉴权/租户隔离/审计与 G0 一致
- [ ] 前端 tsc / vitest / qa / build 全绿
- [ ] 门户 AI Data 列表与详情真实渲染，`build` 在引擎未装配时返回明确不可用

#### 边界与回滚

- 不实现评估算法、不引入新服务；评估引擎在 G9 落地
- 回滚 = 移除迁移 + 前端页面 revert

#### 延后清单

- Recipe 执行器；真实评估；OpenMetadata 回写；RAG 加工

---

### Gate 9：AI Ready Engine MVP

#### Goal

实现 `ai-ready-service`（评估引擎）：Requirement 定义、Workload Profile、6C 聚合评分、Doris/OpenMetadata Adapter、Certification Gate 雏形；首批 10 个 Requirement + 2 个 Profile 跑通完整评估。

#### Scope

- 新增 `services/ai-ready-service/`（Python 3.12 + FastAPI + SQLAlchemy + PyYAML，与 quality-runner 同栈，部署形态一致）
- 仓库结构（新建目录，声明即 Git 资产）：
  ```text
  ai-ready/
  ├── profiles/
  │   ├── medical-rag.yaml
  │   └── medical-training.yaml
  ├── requirements/
  │   ├── clean/        # data_completeness, data_freshness, mpi_confidence, icd_mapping_coverage
  │   ├── contextual/   # semantic_documentation
  │   ├── consumable/   # chunk_source_attribution
  │   ├── correlated/   # lineage_completeness
  │   └── compliant/    # pii_classification, deidentification, patient_split_leakage
  └── policies/
  ```
- Requirement 结构：check / diagnostic / remediation / weight / severity / applicable_profiles
- Adapter：
  - Doris Adapter（SQL check，读取证书/配置方式复用控制面模式）
  - OpenMetadata Adapter（读 Metadata / Lineage / Classification / Owner / Glossary）
- 评估执行：每项 Requirement 输出 PASS/WARN/FAIL/N/A，6C 分值 0–1，Overall 加权，Certification Gate（<0.70 FAIL / 0.70–0.85 REVIEW / ≥0.85 候选 + Critical 一票否决，人工审批占位）
- API + CLI：`POST /assess {product, profile}`、`GET /readiness`、`data-os ai-ready assess ... --profile`
- 结果回写 control-plane（version.readiness 持久化）

#### 验收清单

- [ ] medical-rag Profile 10 个 Requirement 全部可执行（Doris 合成数据 + OM 实测）
- [ ] 评分聚合正确（已知输入输出对拍）
- [ ] Critical FAIL 一票否决生效
- [ ] 幂等重跑结果一致；无口令泄漏
- [ ] pytest 全绿；远程开发环境部署 + API 验收
- [ ] CLI 输出与架构文档 §34 样例一致

#### 边界与回滚

- 不做数据加工（G10）；Evaluation 指标（G11）；新服务回滚 = 容器下线 + 结果字段保留

#### 延后清单

- medical-agent profile；Embedding/Chunk 检查的模型调用；自动 remediation

---

### Gate 10：RAG 数据集工厂（医疗 RAG 第一条链）

#### Goal

引入 Docling + Data-Juicer，跑通 `Trusted Document → Recipe → Build → Assess → Certified Dataset` 完整链路，产出第一条可检索的 Medical RAG Corpus（合成/脱敏文档，标注 PHI 边界）。

#### Scope

- Docling 集成（Python worker：PDF/DOCX/HTML → Markdown/JSON；医学指南/政策/制度类文档）
- Data-Juicer pipeline Recipe 化：
  ```text
  document_parse → text_normalization → template_removal → deduplicate
  → pii_detection → deidentification → semantic_chunk → chunk_quality_score → metadata_enrichment
  ```
- Recipe 落地 `ai-data/recipes/medical-rag-v1.yaml`（Git 版本化）
- 产物版本化落 RustFS/对象存储：
  ```text
  ai-data/medical-rag-guideline/v1.0.0/
  ├── data/  ├── manifest.yaml  ├── quality.json  ├── readiness.json
  ```
  生产版本不可覆盖
- 与 G9 引擎联动：build → assess（medical-rag profile）→ certification 候选
- OpenLineage 事件：dataset build job 输入/输出（沿用统一血缘标准）

#### 验收清单

- [ ] Docling 实测解析 ≥1 类真实文档形态 → Markdown 无结构性丢失
- [ ] Recipe 幂等重跑（同输入同输出，无重复 chunk）
- [ ] PII/脱敏检测在合成样本上命中预期（阳性/阴性样例）
- [ ] chunk 结果可检索（长度分布、语义完整性抽查）
- [ ] 产物 manifest/quality/readiness.json 齐全且指向明确 source + recipe + git commit
- [ ] 生产版本不可覆盖约束生效（重跑生成 v1.0.1 而非覆盖 v1.0.0）
- [ ] G9 评估跑通：v1.0.0 拿到 medical-rag 评分进入 CERTIFIED 候选

#### 边界与回滚

- 合成/脱敏文档验收，不引入真实临床病历；不自研向量库（检索验证用轻量方案）
- 回滚 = recipe 版本回退，产物只增不改

#### 延后清单

- 嵌入与向量索引生产化；多文档类型管道；chunk 的 LLM 语义评测（G11 部分）

---

### Gate 11：评测与认证闭环

#### Goal

建立 AI 应用评测（RAG Eval 首批）与 Certification Gate 完整闭环：评估结果回写版本、认证审批流转、回写 OpenMetadata，形成"数据构建—AI 消费—评测—反馈"的连接。

#### Scope

- 评测面（`evaluation/rag/`）：用合成 eval set 跑 Retrieval Recall / Precision / MRR / Faithfulness / Citation Correctness
- Certification：自动检查 + 人工审批（复用控制面审批/审计模式），状态 CERTIFIED 后才允许标记 SERVING
- 回写 OpenMetadata：AI Ready Score / Profile / Certification / Last Assessment 写入产品实体元数据
- 前端：产品详情展示 readiness 分数、认证状态、评测指标（真实数据）
- Label Studio 不强制引入——本轮仅评估"评测结果校验"是否需要人工标注，若需要则以容器化试点 + 合成任务落地

#### 验收清单

- [ ] RAG Eval 指标在合成 eval set 上可复现（分数可解释）
- [ ] Certification 全流程：候选 → 人工审批 → CERTIFIED / 退回（REVIEW）
- [ ] Critical FAIL 无法 CERTIFIED（负向用例）
- [ ] OpenMetadata 产品实体创建成功且含评分/认证/评测元数据（OM UI 截图归档）
- [ ] 门户口径：分数/认证/评测趋势真实渲染；demo 构建零改动
- [ ] 既有回归全绿（OM 三库对账无差异；control-plane mvn / 前端全绿）

#### 边界与回滚

- 不做真实 LLM 调用链评测（评测数据为合成）；Label Studio 若引入仅试点
- 回滚 = 评测作业可停 + 认证状态可退回

#### 延后清单

- Agent Eval；真实大模型评测端点；评测结果自动触达 Recipe 调整（G12 部分）

---

### Gate 12：数据飞轮与门户收口

#### Goal

形成 `Failure Sample → Feedback → Recipe/Rule/Label 更新 → 新版本 → 重评 → 发布` 的 AI 数据飞轮闭环，完善门户 AI Data 工作台与 Dashboard，收口文档与复盘。

#### Scope

- 飞轮闭环：
  ```text
  评测失败样本 → 标记 feedback（类型：chunk 不合理/缺文档/脱敏误伤/标签错误）
  → 生成 Dataset 候选（新 recipe 版本或规则调整）
  → G9 评估 + G11 评测 → 人工评审 → CERTIFIED → 发布新版本
  ```
  Production/Learning Plane 分离：候选不自动上线
- 门户 AI Data 工作台：产品列表（Score/Certification/Freshness/Consumers）、版本时间线、评测趋势、Feedback 队列
- AI Ready Dashboard 指标（架构文档 §36）
- 文档收口：架构文档批准为实施基线、CONTEXT.md 术语定稿、AGENTS.md 注册 ai-ready-service、tasks/lessons.md 复盘

#### 验收清单

- [ ] 飞轮全链路演示：失败样本 → 新版本 → 重评分数提升（合成场景实测）
- [ ] 候选版本不能直接进 SERVING（强制评审）
- [ ] 门户工作台全部真实 API，Dashboard 指标可计算
- [ ] 文档/AGENTS/CONTEXT 与实现一致
- [ ] 全量回归 + 全面复盘

#### 边界与回滚

- 不接真实临床数据与真实大模型反馈（仍为受控试点基线）
- 飞轮闭环可人工开关，Learning Plane 改动不影响 Production

#### 延后清单

- medical-training Profile 数据工厂；medical-agent Profile；Embedding 生产化；真实院方文档接入

---

## 五、里程碑与依赖

| 里程碑 | 内容 | 依赖 | 完成标志 |
|---|---|---|---|
| M1 | AI Ready 域落地 | G8 | 产品可创建、版本可追踪、门户可见 |
| M2 | 首个评估引擎 | G8→G9 | medical-rag/training 评估真实可跑 |
| M3 | 第一条医疗 RAG Corpus | G9→G10 | 合成文档全链 Certified 候选 |
| M4 | 评测认证闭环 | G10→G11 | CERTIFIED 才可 SERVING，回写 OM |
| M5 | 数据飞轮 | G11→G12 | 失败样本驱动版本改进，门户收口 |

风险与对策：

- **Data-Juicer/Docling 环境与离线依赖**（延续 G0 经验）→ 镜像构建先行、离线包验证，参照 SeaTunnel 离线发布流程
- **评估引擎口径漂移**（6C 分值与要求不一致）→ Requirement 以 Git 声明为唯一口径，评估结果对拍测试
- **Chunk 质量难量化** → 先以可解释的规则指标（长度/完整性/引用）落地，LLM 类评测延后
- **范围膨胀** → 每个 Gate 明确"延后清单"，medical-agent/training 数据工厂明确排期在 G12 之后

---

## 六、已确认决策与待确认事项

1. ✅ **`ai-ready-service` 技术栈：Python 3.12 + FastAPI**（与 quality-runner 同栈；2026-08-26 cywu 拍板，先 Java 后改 Python）。理由：评估引擎以 SQL Check + 声明式 YAML + 元数据分析为主，且 Docling/Data-Juicer 均为 Python 生态；Java 控制面继续管 API/状态机/审计，职责边界干净。
2. ✅ **G8–G12 连续执行**（2026-08-26 cywu 拍板）：每 Gate 2–3 天，约 2–3 周推完；每个 Gate 独立验收后提交推送。
3. ✅ **第一条 RAG Corpus 验收数据形态：合成医疗文档**（2026-08-26 cywu 拍板）：可直接开工、无外部依赖、PHI 边界可控；院方真实脱敏文档列为 G12 之后的延后接入项。
4. ✅ **Label Studio 整体延后**（2026-08-26 cywu 拍板）：G11 用规则化评测先跑通认证闭环，标注平台排到 G12 之后。
5. ✅ 文档落地已先行完成：README 文档地图、CONTEXT.md 术语、tasks/todo.md 登记均已更新（AGENTS.md 子工程注册待 G9 服务实际建立时执行，避免注册未实现组件）。

> **截至 2026-08-26 全部决策已确认，G8 立即开工。**
