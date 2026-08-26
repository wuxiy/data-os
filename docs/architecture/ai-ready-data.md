# Data-OS AI Ready Data 架构方案

> 版本：v1.0
> 日期：2026-08-26
> 状态：架构设计稿（待 G8 评审批准后转为实施基线）
> 适用范围：Data-OS 医疗数据平台 / AI Data Plane / AI 数据治理
> 核心定位：将可信医疗数据持续加工、评测和认证为可被 RAG、Agent、模型训练与评测直接消费的 AI-Ready Data Product
> 落盘记录：2026-08-26 由 cywu 与 Alma 在会话中确认的设计稿 v1.0 落盘；实施节奏见 `../ai-ready-iteration-plan-20260826.md`

---

## 1. 背景

Data-OS 当前已经具备较完整的传统数据平台能力：

- 多医院、多 HIS / EMR / LIS / 体检 / 区域平台的数据采集；
- Doris 数据仓库；
- ODS / DWD / DWS / ADS 分层建模；
- dbt 数据转换与规则代码化；
- 数据质量检测；
- MPI 患者主索引；
- OpenMetadata 元数据、数据资产与血缘管理；
- BI、科研、监管和 AI 数据集消费；
- 基于使用反馈持续优化数据质量的数据飞轮。

现有架构已经可以持续产生"可信业务数据"，但 AI 应用对数据提出了进一步要求。

传统数据治理通常回答：

> 数据是否准确、完整、一致、及时？

AI 场景还需要回答：

> 数据是否适合某个具体 AI Workload 使用？
> 模型是否能理解数据语义？
> 数据是否可以直接用于 RAG / Agent / Training？
> 数据是否有明确版本、来源、血缘和用途约束？
> AI 输出是否能够追溯到原始 Evidence？
> 这份数据是否经过面向 AI Workload 的实际评测？

因此，Data-OS 需要在 Trusted Data Foundation 之上增加独立的 **AI Data Plane**，将"AI 数据集导出"升级为完整的 **AI-Ready Data Product 生命周期管理能力**。

---

## 2. AI Ready Data 定义

Data-OS 中的 AI Ready Data 定义为：

> **针对一个明确 AI Workload，已经达到机器可理解、可直接消费、可信、及时、可追溯、合规，并经过实际 AI 应用验证的数据产品。**

AI Ready 不是一个与使用场景无关的绝对状态。

例如：

- 一张标准化后的诊断明细表可能已经适合 BI；
- 但对于 RAG，可能仍缺少语义解释、引用来源、Chunk、Embedding 和检索评测；
- 对于模型训练，还需要样本划分、标签质量、数据泄漏、类别分布和版本控制；
- 对于 Agent，还需要实体关系、工具 Schema、权限边界和实时性约束。

因此：

```text
AI Ready
=
Data Quality
× Semantic Context
× AI Consumability
× Workload Fit
× Governance
× Evaluation
```

---

## 3. AI Ready 6C 模型

Data-OS 参考 Snowflake AI-Ready Data Framework，将 AI Ready 拆分为六个核心维度。

| 维度 | 含义 | Data-OS 对应能力 |
|---|---|---|
| Clean | 数据准确、完整、一致、有效 | dbt、质量规则、MPI、编码映射 |
| Contextual | 数据具有机器可理解的业务语义 | OpenMetadata、Glossary、Semantic Model、FHIR/ICD/LOINC |
| Consumable | 数据已经转换成 AI 可以直接使用的形态 | Data-Juicer、Chunk、Embedding、Feature、Sample |
| Current | 数据的新鲜度满足场景要求 | CDC、Freshness SLA、延迟检测 |
| Correlated | 数据从源到 AI 输出均可追溯 | OpenMetadata、OpenLineage、Dataset Version |
| Compliant | 数据访问、隐私、用途均受到治理 | RBAC、脱敏、PII/PHI 分类、审计、用途控制 |

AI Ready 不使用一个统一固定阈值，而是通过不同 **Workload Profile** 组合不同要求。

---

## 4. 架构目标

AI Ready 模块需要实现以下目标：

1. 将 Data-OS 的 AI 数据能力从"ADS 数据导出"升级为"AI Data Product"；
2. 支持 RAG、Agent、模型训练、Feature Serving、Evaluation 等不同 AI Workload；
3. 建立 AI 数据产品从创建、加工、评测、认证、服务到下线的完整生命周期；
4. 使 AI 数据构建过程 Recipe 化、版本化、可复现；
5. 所有 AI 数据均可追溯到可信业务数据和原始 Evidence；
6. 将传统数据质量检测扩展为 AI Workload Readiness Assessment；
7. 构建医疗行业专属 AI Ready Profile；
8. 将 AI 应用评测结果反馈到数据构建和数据治理环节；
9. 保持 Data-OS"轻量、可维护、组件职责清晰"的总体原则；
10. 优先复用成熟开源组件，不重复建设通用执行引擎。

---

## 5. 非目标

当前阶段不计划：

- 自研完整的数据湖 / Lakehouse；
- 自研通用数据编排引擎；
- 自研完整向量数据库；
- 自研通用数据标注平台；
- 自研完整元数据平台；
- 将 Data-Juicer 替代 SeaTunnel、dbt 或 Doris；
- 将所有 ADS 数据自动标记为 AI Ready；
- 允许 AI 自动修改生产治理规则并立即生效；
- 允许未经过认证的数据直接进入生产级医疗 AI 场景。

---

## 6. 总体架构

```text
                              Data-OS

┌──────────────────────────────────────────────────────────────┐
│                       Source Layer                           │
│ HIS / EMR / LIS / PACS / 体检 / 区域平台 / 文档 / PDF       │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                    Data Integration Plane                    │
│ SeaTunnel / NiFi / CDC / API / File                         │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                  Trusted Data Foundation                     │
│                                                              │
│ Doris                                                        │
│ ODS → DWD → DWS → ADS                                       │
│                                                              │
│ dbt / Data Quality / MPI / Master Data / Standard Mapping    │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                       AI Data Plane                          │
│                                                              │
│ Dataset Builder                                              │
│ Data-Juicer                                                  │
│ Docling                                                      │
│ Label Studio                                                 │
│ Sampling / Filtering / Dedup / Chunk / Annotation            │
│ De-identification / Synthetic Data / Dataset Split           │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                AI Ready Control Plane                        │
│                                                              │
│ AI Ready Engine                                              │
│ 6C Assessment                                                │
│ Workload Profile                                             │
│ Medical Profile                                              │
│ Data Contract                                                │
│ Certification                                                │
│ Dataset Version                                              │
│ Policy / Audit                                               │
│                                                              │
│ OpenMetadata + OpenLineage                                   │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                Certified AI Data Products                    │
│                                                              │
│ RAG Corpus                                                   │
│ Training Dataset                                             │
│ Agent Context                                                │
│ Feature Dataset                                              │
│ Evaluation Dataset                                           │
│ Multimodal Dataset                                           │
└────────────────────────────┬─────────────────────────────────┘
                             │
                ┌────────────┼─────────────┐
                ▼            ▼             ▼
               RAG          Agent       Training
                │            │             │
                └────────────┼─────────────┘
                             ▼
                       AI Evaluation
                             │
                             ▼
                         Feedback
                             │
         ┌───────────────────┴────────────────────┐
         ▼                                        ▼
   Data Recipe                               Governance Rule
   Label / Sample                            Quality / Metadata
         │                                        │
         └───────────────────┬────────────────────┘
                             ▼
                        Better Data
```

---

## 7. Data Plane 划分

### 7.1 Data Integration Plane

负责：

> 把数据可靠地搬进来。

主要组件：

- SeaTunnel；
- NiFi / MiNiFi；
- Debezium；
- API Adapter；
- 文件采集；
- Kafka / Redpanda。

不负责：

- AI 样本质量；
- Chunk；
- Embedding；
- Training Dataset；
- AI Readiness 评估。

### 7.2 Trusted Data Plane

负责：

> 把数据治理正确。

主要组件：

- Doris；
- dbt；
- Data Quality；
- MPI；
- Master Data；
- ICD / 药品 / 检验映射；
- 脱敏；
- 数据标准化。

数据输出：

```text
ODS
 ↓
DWD
 ↓
DWS
 ↓
ADS
```

该平面的目标是：

> Trusted Business Data

而不是直接等价于 AI Ready Data。

### 7.3 AI Data Plane

负责：

> 把可信业务数据加工成 AI 真正可以消费的数据。

主要能力：

- AI Dataset Build；
- Filtering；
- Deduplication；
- Sampling；
- Dataset Balancing；
- Chunking；
- Annotation；
- Synthetic Data；
- De-identification；
- Train / Validation / Test Split；
- RAG Corpus Build；
- Agent Context Build；
- Evaluation Dataset Build；
- Multimodal Dataset Build。

核心执行引擎：

> **Data-Juicer**

---

## 8. Data-Juicer 定位

Data-Juicer 在 Data-OS 中定位为：

> **AI Dataset Curation Engine**

其职责不是进行传统 ETL，而是将 Trusted Data 转换成适合特定 AI Workload 的数据集。

### 8.1 与现有组件的职责边界

| 组件 | 核心职责 |
|---|---|
| SeaTunnel / NiFi | 数据采集和同步 |
| Doris | 数据存储和 OLAP |
| dbt | 结构化数据治理和建模 |
| MPI | 患者身份统一 |
| OpenMetadata | Metadata / Catalog / Lineage / Governance |
| Data-Juicer | AI Dataset Curation |
| AI Ready Engine | AI Readiness Assessment / Certification |

关系：

```text
SeaTunnel
负责"搬数据"

dbt + MPI
负责"把数据治理正确"

Data-Juicer
负责"把数据加工成 AI 吃得下的数据"

AI Ready Engine
负责"判断数据是否真的可以给 AI 使用"
```

---

## 9. Data-Juicer 典型处理流程

### 9.1 RAG 数据集

```text
Trusted Document
      │
      ▼
Document Parse
      │
      ▼
Normalization
      │
      ▼
Template Removal
      │
      ▼
Deduplication
      │
      ▼
Quality Filtering
      │
      ▼
Semantic Chunking
      │
      ▼
Chunk Quality Check
      │
      ▼
Sensitive Data Check
      │
      ▼
Metadata Enrichment
      │
      ▼
RAG Corpus
```

### 9.2 模型训练数据集

```text
Trusted Data
     │
     ▼
Sample Selection
     │
     ▼
Deduplication
     │
     ▼
Quality Filtering
     │
     ▼
Label / Annotation
     │
     ▼
Data Balance
     │
     ▼
Patient-Level Split
     │
     ▼
Leakage Detection
     │
     ▼
Train / Validation / Test
```

### 9.3 Agent 数据

```text
业务数据
  +
Schema
  +
Metadata
  +
Business Rules
  +
Tool Definition
  +
Policy
      │
      ▼
Agent Context Product
```

---

## 10. Recipe 化

所有 AI Dataset 构建过程必须 Recipe 化。

示例：

```yaml
apiVersion: data-os/v1
kind: AIDatasetRecipe

metadata:
  name: medical-rag-v1
  version: 1.0.0

spec:
  source:
    dataset: dwd_medical_document

  workload:
    type: medical-rag

  pipeline:
    - document_parse
    - text_normalization
    - template_removal
    - deduplicate
    - pii_detection
    - deidentification
    - semantic_chunk
    - chunk_quality_score
    - metadata_enrichment

  output:
    format: jsonl
    dataset: medical-rag-corpus
```

Recipe 放入 Git：

```text
ai-data/
├── recipes/
│   ├── medical-rag-v1.yaml
│   ├── medical-rag-v2.yaml
│   ├── medical-sft-v1.yaml
│   ├── medical-agent-v1.yaml
│   └── medical-eval-v1.yaml
```

Recipe 需要具备：

- Version；
- Owner；
- Git Commit；
- Input Dataset；
- Output Dataset；
- Operator Version；
- Parameters；
- Execution Run；
- Evaluation Result。

---

## 11. AI Data Product

Data-OS 将 AI Data Product 作为一等领域对象。

### 11.1 数据产品类型

```text
AIDataProduct
├── RAGCorpus
├── TrainingDataset
├── InstructionDataset
├── PreferenceDataset
├── FeatureDataset
├── AgentContextProduct
├── EvaluationDataset
└── MultimodalDataset
```

### 11.2 RAGCorpus

适用于：

- 医学指南；
- 临床知识库；
- 医院制度；
- 医疗政策；
- 病历文档；
- 科研文献。

核心属性：

```text
Document
Chunk
Embedding
Metadata
Citation
Source
Version
Permission
Freshness
```

### 11.3 TrainingDataset

适用于：

- 分类模型；
- NLP 模型；
- SFT；
- 医疗问答；
- 医疗摘要；
- 诊断辅助模型。

核心属性：

```text
Sample
Label
Source
Patient Scope
Split
Version
Quality Score
Distribution
License / Purpose
```

### 11.4 AgentContextProduct

Agent 需要的不只是文本。

一个完整 Agent Context 应包括：

```text
Data
+
Schema
+
Semantic
+
Business Rule
+
Tool Schema
+
Access Policy
+
Freshness
+
Evidence
```

例如：

```text
patient
encounter
diagnosis
order
lab_result
medication

+
实体关系

+
字段语义

+
FHIR / ICD / LOINC

+
查询权限

+
API Tool Schema
```

---

## 12. AI Data Product Manifest

每个 AI Data Product 必须具有 Manifest。

```yaml
apiVersion: data-os/v1
kind: AIDataProduct

metadata:
  name: medical-rag-diagnosis
  version: 1.2.0
  owner: data-team

spec:

  workload:
    type: medical-rag

  source:
    domain: diagnosis
    dataset: dwd_diagnosis
    snapshot: 2026-08-20

  semantics:
    primary_entity: golden_person
    diagnosis_system: ICD-10

  quality:
    completeness: 0.98
    mapping_coverage: 0.99

  freshness:
    max_delay: 1h

  privacy:
    contains_phi: true
    deidentified: true

    allowed_purpose:
      - research
      - clinical-assistant

  lineage:
    recipe: medical-rag-v2
    git_commit: abc123

  readiness:
    profile: medical-rag

  certification:
    status: certified
```

推荐原则：

> Git 管声明和配置，OpenMetadata 管运行态 Metadata。

---

## 13. Dataset Version

AI 数据必须具备不可变版本。

示例：

```text
medical-rag-guideline
├── v1.0.0
├── v1.1.0
└── v2.0.0
```

一个版本必须能够回答：

- 使用了哪些 Source Dataset；
- 数据快照时间；
- 使用哪个 Recipe；
- 使用哪个 Git Commit；
- 使用哪个 Data-Juicer Version；
- 使用哪些 Operator；
- 文档解析器版本；
- Chunk Algorithm；
- Embedding Model；
- Label Version；
- Quality Score；
- AI Ready Assessment；
- Evaluation Result。

推荐对象存储路径：

```text
ai-data/
└── medical-rag-guideline/
    ├── v1.0.0/
    │   ├── data/
    │   ├── manifest.yaml
    │   ├── quality.json
    │   ├── readiness.json
    │   └── evaluation.json
    │
    └── v1.1.0/
```

生产版本不可覆盖。

---

## 14. 生命周期

AI Data Product 生命周期：

```text
DRAFT
  │
  ▼
CURATED
  │
  ▼
ASSESSED
  │
  ▼
CERTIFIED
  │
  ▼
SERVING
  │
  ▼
DEPRECATED
```

### DRAFT

已经定义数据产品，但尚未构建。

### CURATED

完成 Data-Juicer / Dataset Builder 数据加工。

### ASSESSED

完成 AI Ready Assessment。

### CERTIFIED

达到对应 Profile 阈值，并经过审核。

### SERVING

已经用于生产：

- RAG；
- Agent；
- Training；
- Feature Serving。

### DEPRECATED

不再推荐使用，但历史版本仍然可追溯。

---

## 15. AI Ready Engine

新增：

> **data-os-ai-ready**

定位：

> Data-OS AI Data Readiness Assessment & Certification Engine

核心职责：

```text
Scan
 ↓
Assess
 ↓
Diagnose
 ↓
Remediate
 ↓
Re-Assess
 ↓
Certify
```

---

## 16. Assessment 模型

每项 Requirement 输出：

```text
PASS
WARN
FAIL
NOT_APPLICABLE
```

并生成评分：

```text
0.0 ~ 1.0
```

示例：

```text
Medical RAG Readiness

Clean          0.94
Contextual     0.82
Consumable     0.88
Current        0.97
Correlated     0.76
Compliant      1.00

Overall        0.89
```

问题：

```text
WARN
semantic_documentation

FAIL
chunk_source_attribution

FAIL
lineage_completeness
```

---

## 17. Requirement 设计

每个检查项包含：

```text
Requirement
├── Check
├── Diagnostic
├── Remediation
├── Weight
├── Severity
└── Applicable Profiles
```

仓库结构：

```text
ai-ready/
├── requirements/
│   ├── data-completeness/
│   │   └── doris/
│   │       ├── check.sql
│   │       ├── diagnostic.sql
│   │       └── fix.md
│   │
│   ├── data-freshness/
│   ├── lineage-completeness/
│   ├── semantic-documentation/
│   ├── pii-classification/
│   ├── deidentification/
│   ├── mpi-confidence/
│   ├── icd-mapping-coverage/
│   ├── patient-split-leakage/
│   └── chunk-source-attribution/
```

---

## 18. Workload Profile

Data-OS 不定义一个统一的 AI Ready 标准。

基础 Profile：

```text
rag
agents
training
feature-serving
evaluation
```

医疗扩展：

```text
medical-rag
medical-agent
medical-training
medical-research
medical-evaluation
```

Profile 本质是：

```text
Requirements
+
Weights
+
Thresholds
+
Policy
```

---

## 19. medical-rag Profile

重点检查：

### Clean

- 文档完整度；
- 重复文档比例；
- OCR / Parse 错误率；
- ICD / 药品 / 检验映射覆盖率；
- MPI Golden Person 质量。

### Contextual

- 文档类型；
- 科室；
- 就诊时间；
- 数据来源；
- 实体关系；
- 单位；
- 编码体系；
- 业务术语；
- FHIR Mapping。

### Consumable

- Chunk 长度；
- Chunk 完整性；
- Chunk 是否破坏临床语义；
- Embedding 可生成；
- Metadata 完整度；
- Citation 可用。

### Current

- 文档更新时间；
- 数据延迟；
- Index 更新时间；
- Freshness SLA。

### Correlated

```text
Vector
 ↓
Chunk
 ↓
Document
 ↓
DWD
 ↓
ODS
 ↓
Source System
```

必须完整可追溯。

### Compliant

- PHI / PII 分类；
- 脱敏；
- Patient Scope；
- 数据用途；
- 访问控制；
- 查询审计。

### Evaluation

增加 AI 应用实际指标：

- Retrieval Recall；
- Precision；
- MRR / NDCG；
- Citation Correctness；
- Faithfulness；
- Context Relevance；
- Hallucination Rate。

---

## 20. medical-training Profile

训练数据需重点增加：

```text
Patient-Level Train/Test Isolation
Time Leakage Detection
Cross-Hospital Distribution
Disease Distribution
Rare Disease Coverage
Duplicate Sample Detection
Label Quality
Label Consistency
Class Balance
Demographic Bias
Source Bias
Data Reproducibility
Purpose Limitation
```

尤其医疗场景需要避免：

```text
同一个患者
同时进入 Train 和 Test
```

以及：

```text
预测时不可获得的未来数据
进入训练特征
```

---

## 21. medical-agent Profile

Agent Ready 重点不只是数据质量。

需要确保：

### Schema

Agent 能理解：

```text
patient
encounter
diagnosis
order
lab
medication
```

之间的关系。

### Semantic

字段必须具有明确语义。

### Tool

Agent 获取数据必须通过受控 Tool：

```text
query_patient
query_encounter
query_lab_result
query_medication
```

而不是默认允许模型直接访问数据库。

### Policy

必须定义：

```text
Who
Can Access
What Data
For What Purpose
Under What Context
```

### Evidence

任何 Agent 事实输出都必须可追溯到 Evidence。

---

## 22. OpenMetadata 集成

OpenMetadata 继续作为：

> **Metadata / Semantic / Governance Source of Truth**

主要承载：

- Dataset；
- Data Product；
- Glossary；
- Classification；
- Owner；
- Domain；
- Lineage；
- Quality；
- Contract；
- Policy；
- Certification；
- ML Model；
- AI Data Product Metadata。

Data-OS AI Ready Engine 将 Assessment 结果回写 OpenMetadata。

例如：

```text
medical-rag-diagnosis

AI Ready Score
0.89

Profile
medical-rag

Certification
CERTIFIED

Last Assessment
2026-08-26
```

---

## 23. OpenLineage

Data-OS 建议使用 OpenLineage 作为跨执行引擎的数据血缘事件标准。

统一表示：

```text
Job
Run
Input Dataset
Output Dataset
```

应用：

```text
SeaTunnel
dbt
Data-Juicer
Airflow
Python Worker
AI Dataset Builder
```

最终均汇入 OpenMetadata。

避免 Data-OS 自行定义私有血缘协议。

---

## 24. Label Studio

Label Studio 定位：

> Human Annotation / Review Plane

主要场景：

- 医疗专家标注；
- 病历分类；
- 实体标注；
- 问答标注；
- Ground Truth；
- 模型结果 Review；
- RAG 相关性标注；
- Agent Action Review。

推荐形成：

```text
Model Pre-Label
      │
      ▼
Human Review
      │
      ▼
Ground Truth
      │
      ▼
Evaluation Dataset
      │
      ▼
Model / Data Improvement
```

---

## 25. Docling

Docling 主要用于：

> 非结构化文档 → AI 可处理结构

例如：

```text
PDF
DOCX
PPTX
HTML
      │
      ▼
Document Structure
      │
      ▼
Markdown / JSON
```

适合处理：

- 医学指南；
- 医疗政策；
- 医院制度；
- 科研论文；
- 体检报告；
- 医疗说明书。

Docling 作为 Python Library / Worker 集成，不单独建设复杂平台。

---

## 26. Data Contract

每个 Certified AI Data Product 必须具备 Data Contract。

Contract 至少定义：

```text
Schema
Semantic
Quality
Freshness
Privacy
Purpose
Owner
SLA
Lineage
Version
```

示例：

```yaml
contract:

  schema:
    required:
      - document_id
      - chunk_id
      - text
      - source

  quality:
    completeness: ">=0.98"

  freshness:
    max_delay: "24h"

  lineage:
    required: true

  privacy:
    deidentified: true

  usage:
    allowed:
      - internal-rag

    denied:
      - public-training
```

---

## 27. Certification Gate

建议默认策略：

```text
AI Ready Score < 0.70
→ FAIL

0.70 ~ 0.85
→ REVIEW

>= 0.85
→ 可以进入认证候选

Critical Requirement FAIL
→ 无论总分多少都不能 CERTIFIED
```

Critical Requirement 示例：

- 脱敏失败；
- 权限缺失；
- 来源不可追溯；
- Train/Test Patient Leakage；
- Evidence 丢失；
- 数据用途不允许。

最终认证需支持：

```text
Automatic Check
+
Human Approval
```

---

## 28. Feedback Loop

AI Ready 的关键不是一次性构建 Dataset。

必须形成：

```text
Data
 ↓
AI Data Product
 ↓
AI Application
 ↓
Evaluation
 ↓
Failure Sample
 ↓
Feedback
 ↓
Recipe / Rule / Label
 ↓
New Dataset Version
```

例如 RAG：

```text
用户问题
 ↓
检索失败
 ↓
发现 Chunk 不合理
 ↓
标记 Failure Sample
 ↓
调整 Chunk Recipe
 ↓
生成 v1.1
 ↓
重新评测
```

这才是 Data-OS AI 数据飞轮。

---

## 29. 与 MPI Learning Plane 的统一思想

Data-OS MPI 已采用：

```text
Production Plane
+
Learning Plane
```

AI Ready Data 同样采用类似原则：

```text
Production Data Plane
+
AI Data Learning Plane
```

Production Plane：

- 稳定；
- 可解释；
- 可审计；
- 可回滚。

Learning Plane：

- Experiment；
- Sampling；
- Data-Juicer；
- Label；
- Evaluation；
- Benchmark。

不允许：

```text
一次模型反馈
→ 自动修改生产数据规则
→ 立即上线
```

推荐流程：

```text
Feedback
 ↓
Experiment
 ↓
Dataset Candidate
 ↓
Assessment
 ↓
Evaluation
 ↓
Review
 ↓
Certified
 ↓
Release
```

---

## 30. 推荐技术栈

| 能力 | 推荐组件 |
|---|---|
| 数据采集 | SeaTunnel / NiFi |
| CDC | Debezium |
| 数据存储 | Apache Doris |
| 数据建模 | dbt Core |
| 数据质量 | dbt test + Great Expectations / OpenMetadata |
| MPI | Data-OS MPI |
| Metadata | OpenMetadata |
| Data Contract | OpenMetadata + Git Manifest |
| Lineage | OpenMetadata + OpenLineage |
| AI Dataset Curation | Data-Juicer |
| 文档解析 | Docling |
| 人工标注 | Label Studio |
| AI Ready Framework | Snowflake AI-Ready Framework 思想 + Data-OS 实现 |
| AI Ready Engine | data-os-ai-ready |
| Dataset Artifact | S3 / RustFS / Object Storage |
| Dataset Manifest | YAML + Git |
| 调度 | Airflow / Data-OS Scheduler |
| AI Evaluation | Data-OS Eval Plane |

---

## 31. 不建议当前引入

为了控制系统复杂度，当前阶段不建议同时引入：

- NeMo Curator；
- DVC；
- lakeFS；
- Feature Store；
- 独立 Dataset Registry；
- 多套 Metadata 平台；
- 自研向量数据库；
- 自研标注系统。

优先原则：

> 一个能力尽量只有一个 Source of Truth。

---

## 32. 推荐仓库结构

```text
data-os/
│
├── apps/
│
├── services/
│   ├── data-api/
│   ├── mpi-service/
│   └── ai-ready-service/
│
├── data/
│   ├── dbt/
│   ├── quality/
│   └── mappings/
│
├── ai-data/
│   │
│   ├── products/
│   │   ├── medical-rag/
│   │   ├── medical-training/
│   │   └── medical-agent/
│   │
│   ├── recipes/
│   │   ├── medical-rag-v1.yaml
│   │   ├── medical-training-v1.yaml
│   │   └── medical-agent-v1.yaml
│   │
│   └── manifests/
│
├── ai-ready/
│   │
│   ├── profiles/
│   │   ├── rag.yaml
│   │   ├── agents.yaml
│   │   ├── training.yaml
│   │   ├── medical-rag.yaml
│   │   ├── medical-agent.yaml
│   │   └── medical-training.yaml
│   │
│   ├── requirements/
│   │   ├── clean/
│   │   ├── contextual/
│   │   ├── consumable/
│   │   ├── current/
│   │   ├── correlated/
│   │   └── compliant/
│   │
│   └── policies/
│
├── evaluation/
│   ├── rag/
│   ├── agent/
│   └── training/
│
└── docs/
    └── architecture/
        └── ai-ready-data.md
```

---

## 33. API 设计建议

### 创建 AI Data Product

```http
POST /api/ai-data-products
```

### 构建 Dataset

```http
POST /api/ai-data-products/{id}/build
```

### 执行 Assessment

```http
POST /api/ai-data-products/{id}/assess
```

参数：

```json
{
  "profile": "medical-rag"
}
```

### 获取评分

```http
GET /api/ai-data-products/{id}/readiness
```

### 认证

```http
POST /api/ai-data-products/{id}/certify
```

### 发布

```http
POST /api/ai-data-products/{id}/release
```

---

## 34. CLI 设计建议

```bash
data-os ai-ready assess \
  medical-rag-diagnosis \
  --profile medical-rag
```

输出：

```text
AI Ready Assessment

Product:
medical-rag-diagnosis

Version:
1.2.0

Profile:
medical-rag

Clean          0.94
Contextual     0.82
Consumable     0.88
Current        0.97
Correlated     0.76
Compliant      1.00

Overall        0.89

Result:
REVIEW

FAILED
- chunk_source_attribution

WARN
- semantic_documentation
```

---

## 35. UI 规划

Data-OS Console 增加：

```text
AI Data
│
├── Data Products
├── Dataset Builder
├── Recipes
├── AI Readiness
├── Evaluation
├── Annotation
└── Certification
```

### AI Data Product 页面

展示：

```text
Name
Version
Type
Owner
Source
Profile
AI Ready Score
Certification
Freshness
Quality
Consumers
Lineage
Evaluation
```

---

## 36. AI Ready Dashboard

重点指标：

```text
Certified AI Data Products
Average AI Ready Score
Products by Profile
Failed Requirements
Data Freshness
Lineage Coverage
Semantic Coverage
PHI Classification Coverage
Dataset Build Success Rate
RAG Evaluation Trend
Agent Evaluation Trend
```

---

## 37. 数据飞轮指标

AI Data Flywheel 不只看数据量。

### 数据

- Dataset 数量；
- Certified Dataset 数量；
- Dataset Version 数量；
- AI Ready Score；
- Metadata Coverage；
- Lineage Coverage；
- Semantic Coverage。

### 构建

- Recipe Success Rate；
- Build Duration；
- Filtering Ratio；
- Dedup Ratio；
- Dataset Rebuild Frequency。

### AI

- Retrieval Recall；
- Faithfulness；
- Agent Success Rate；
- Training Dataset Quality；
- Evaluation Pass Rate。

### 飞轮

```text
Failure Sample
→ New Rule

Human Review
→ New Label

Application Feedback
→ New Recipe

New Recipe
→ New Dataset Version
```

衡量：

```text
每月新增有效 Rule
每月新增 Ground Truth
每月 Dataset 改进次数
AI Ready Score 趋势
AI Evaluation 趋势
```

---

## 38. 实施路线

### Phase 0：标准定义

目标：

> 先定义 AI Ready，不急于部署大量组件。

完成：

- AI Data Product Domain Model；
- Manifest；
- Lifecycle；
- 6C；
- Requirement；
- Profile；
- Certification；
- Dataset Version。

### Phase 1：AI Ready MVP

选择两个 Profile：

```text
medical-rag
medical-training
```

实现：

```text
data-os-ai-ready
```

第一批 Requirement：

```text
data_completeness
data_freshness
semantic_documentation
lineage_completeness
pii_classification
deidentification
mpi_confidence
icd_mapping_coverage
chunk_source_attribution
patient_split_leakage
```

执行平台：

```text
Doris
+
OpenMetadata
```

### Phase 2：Dataset Factory

引入：

```text
Data-Juicer
+
Docling
```

跑通：

```text
Trusted Data
 ↓
Recipe
 ↓
Dataset Build
 ↓
AI Ready Assessment
 ↓
Certified Dataset
```

### Phase 3：医疗 RAG

建设第一套生产级：

```text
Medical RAG Corpus
```

形成：

```text
Document
 ↓
Docling
 ↓
Data-Juicer
 ↓
Chunk
 ↓
Embedding
 ↓
AI Ready
 ↓
RAG Eval
```

### Phase 4：Human Ground Truth

引入：

```text
Label Studio
```

支持：

- RAG 相关性标注；
- 医疗实体；
- Training Label；
- Failure Review。

### Phase 5：数据飞轮

形成：

```text
Application
 ↓
Evaluation
 ↓
Failure Sample
 ↓
Label / Rule / Recipe
 ↓
New Dataset Version
 ↓
Re-Evaluation
 ↓
Release
```

---

## 39. 第一阶段建议

第一阶段不要一次性实现完整 AI Data Platform。

建议仅完成：

### 1. AI Data Product

定义：

```text
Manifest
Version
Lifecycle
```

### 2. AI Ready Engine

实现：

```text
Requirement
Profile
Assessment
Score
Certification
```

### 3. 两个 Profile

```text
medical-rag
medical-training
```

### 4. Doris Adapter

支持 SQL Check。

### 5. OpenMetadata Adapter

读取：

```text
Metadata
Lineage
Quality
Classification
Owner
Glossary
```

### 6. 第一批 10~15 个 Requirement

跑通完整流程。

这样即可验证整个 AI Ready 架构，而无需一开始引入复杂的 AI 数据基础设施。

---

## 40. 最终定位

Data-OS 不再只是：

> 医疗数据采集治理平台。

建议升级为：

> **面向医疗行业的 Data & AI Data Operating System。**

其核心能力是：

```text
Raw Data
 ↓
Trusted Data
 ↓
Semantic Data
 ↓
AI-Ready Data Product
 ↓
RAG / Agent / Model / Research / BI
 ↓
Evaluation
 ↓
Feedback
 ↓
Better Data
```

Data-OS 最终需要解决的问题不是：

> "我们有多少数据？"

而是：

> **"这些数据是否可信、是否被理解、是否可以被 AI 正确使用，以及使用之后是否能持续变得更好。"**

这将成为 Data-OS 在 AI 时代区别于传统 ETL、数据中台和数据治理平台的核心能力之一。

---

## 41. 架构决议

当前阶段建议正式确认以下决议：

1. **AI Ready Data 作为 Data-OS 一级能力建设；**
2. **新增 AI Data Plane；**
3. **AI Data Product 成为一等领域对象；**
4. **Data-Juicer 定位为 AI Dataset Curation Engine；**
5. **OpenMetadata 继续作为 Metadata / Semantic / Governance Source of Truth；**
6. **使用 OpenLineage 作为跨执行引擎血缘标准；**
7. **新增 data-os-ai-ready 服务；**
8. **AI Ready 使用 6C + Workload Profile 方式评估；**
9. **首批建设 medical-rag / medical-training Profile；**
10. **所有生产 AI Dataset 必须版本化、可追溯、可评测；**
11. **Certified AI Data Product 才能默认进入生产 AI 场景；**
12. **AI 应用 Evaluation 必须反馈进入 Data Flywheel；**
13. **遵循 Production Plane / Learning Plane 分离原则；**
14. **AI 可以辅助生成 Rule / Recipe / Label，但生产变更必须经过受控评估与审核。**

---

## 42. 参考项目

建议持续跟踪：

- Snowflake-Labs/ai-ready-data
- ModelScope/Data-Juicer
- OpenMetadata
- OpenLineage
- HumanSignal/label-studio
- docling-project/docling
- Great Expectations

以上项目主要作为能力组件或架构参考，不改变 Data-OS 自身在医疗领域的业务模型、治理模型和 AI Ready Profile。