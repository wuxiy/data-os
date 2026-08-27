# G11 评测与认证闭环方案 — 2026-08-27

> 前置：G8（生命周期状态机：ASSESSED→CERTIFIED→SERVING）、G9（评估引擎 +
> CANDIDATE/REVIEW/BLOCKED 语义）、G10（RAG Corpus 与 `dataos_ai.chunks`）、
> 总计划 Gate 11。

目标：补齐「数据构建—评测—认证审批—发布」的最后闭环——RAG Eval（合成集、
五指标、轻量检索）、Certification 人工审批流转（**CERTIFIED 只能经审批**）、
评估/认证/评测元数据回写 OpenMetadata（glossary 面向），门户呈现全链真实状态。

## 一、现状事实

| # | 事实 |
| --- | --- |
| 1 | G8 `transition` 接口可从 ASSESSED **直通 CERTIFIED**（无审批语义）——违反架构 §27「Automatic Check + Human Approval」，是本批要堵的洞 |
| 2 | G10 已产 7 chunks（Doris `dataos_ai.chunks`）；引擎评估 CANDIDATE 语义就位；`readiness_json` 已回写产品版本 |
| 3 | OM 1.5 `glossaries`/`glossaryTerms` API 实测可用（POST 201）；产品实体无 OM 原生类型——**术语表承载**（glossary「AI 数据产品」+ term/产品，认证状态用标签分类）是务实面 |
| 4 | 检索验证：架构 §10 边界「不自研向量库（检索验证用轻量方案）」——自实现 BM25（~60 行，零新依赖）即可满足评测口径 |

## 二、设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| G11-1 | **评测面落引擎服务**（`evaluation/rag/`）：合成 eval set `ai-data/eval/medical-rag-evalset.jsonl`（10 问，每问标注期望来源 document_id/section + golden 句）；检索 = chunks 上的 BM25；指标 = Retrieval Recall@5 / Precision@5 / MRR / Citation Correctness（top 命中的 document_id 正确率）/ Faithfulness（规则版：golden 句必须被检索片段包含）。`POST /evaluate {product, version}` | 引擎同栈同部署；指标可解释可复现（固定语料 + 确定性检索） |
| G11-2 | **认证审批**（control-plane）：V11 迁移 `ai_certification_request`（id/product_id/version_sn/readiness_overall/certification/decision/decided_by/decided_at/created_at，decision ∈ PENDING/APPROVED/REJECTED）；API：`POST /ai-data-products/{id}/certification-requests`（提交校验：当前版本 readiness 存在且 `certification=CANDIDATE`，BLOCKED/FAIL/REVIEW_REQUIRED 拒 409）→ `POST /certification-requests/{rid}/decision` `{approve: true/false, note}`（通过→生命周期流转 CERTIFIED；拒绝→保持 ASSESSED 并记退回）；**transition 接口对目标 CERTIFIED 改为 409**（必须走审批）——人工审批不可绕过 | 架构 §27；审批人取 TenantScope 身份（审计面已有） |
| G11-3 | **evaluate 委托**：`POST /ai-data-products/{id}/evaluate`（control-plane → 引擎 /evaluate → 结果并入当前版本 readiness_json 的 `evaluation` 字段）；评测通过与否**不自动驱动生命周期**（评测是证据，审批是人判断） | 分层：引擎出证据、控制面做决策 |
| G11-4 | **OM 回写**（`deploy/scripts/om-sync-ai-product.sh` 幂等）：glossary「AI 数据产品」+ term（产品名）；term description = 中文摘要（分数/认证/评测/版本/时间）；标签分类 `AIReadiness`（标签：CANDIDATE/CERTIFIED/REVIEW_REQUIRED/BLOCKED）打 term；certify 后重跑即刷新 | OM 无产品原生实体；术语表是治理目录的自然承载，回写即「数据构建→元数据目录」连接 |
| G11-5 | 门户：详情页新增「评测指标」段（readiness.evaluation 投影：五指标+集规模）与「认证审批」区（提交审批/审批通过/退回按钮按角色与状态显隐；审批历史）；版本行已有就绪度不动 | demo 构建零改动 |
| G11-6 | Label Studio 维持不引入（既定决策）；评测集人工校验以 evalset 文件评审替代 | 总计划口径 |

## 三、实施步骤

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| E1 | evalset（10 问）+ BM25 + 五指标 + 引擎 `/evaluate` + pytest（可复现/指标手算对拍/空集边界） | pytest 全绿 |
| E2 | V11 + 审批 API + transition 守卫 + evaluate 委托 + mvn 测试（审批全流程/负向：BLOCKED 拒提交、直通 CERTIFIED 拒 409/重复提交幂等） | mvn 全绿 |
| E3 | OM 回写脚本（幂等，含探针 glossary 清理） | 脚本进 Git；远端实跑 |
| E4 | 前端评测段 + 审批操作 + 状态展示 + vitest | 前端全绿 |
| E5 | 远端：部署 → evaluate 实测 → 审批全流程（提交→通过→CERTIFIED→OM term 打 CERTIFIED 标签）→ 负向 → 截图（OM + 门户） | 全链证据 |
| E6 | gate 报告 + 提交推送 + 记忆 | 报告落库 |

## 四、验收清单（gate）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| A1 | 评测可复现 | 同 evalset 重跑五指标逐值一致；指标含义可解释（每问命中明细留档） |
| A2 | 认证全流程 | CANDIDATE → 提交审批 → 通过 → CERTIFIED（审批人/时间入库）；拒绝路径保持 ASSESSED 并留痕 |
| A3 | 负向守卫 | readiness 为 BLOCKED/REVIEW_REQUIRED/FAIL 时提交审批 409；transition 直通 CERTIFIED 409；无 readiness 提交 409 |
| A4 | OM 回写 | glossary + term + AIReadiness 标签（状态随审批刷新）；OM UI 截图归档 |
| A5 | 门户口径 | 评测五指标、审批操作与历史真实渲染；demo 零改动 |
| A6 | 回归 | pytest / mvn / 前端全绿；OM 三库对账零差异；既有链路零影响 |

## 五、边界与回滚

- 不做：真实 LLM 调用评测、Label Studio、SERVING 之后的发布编排（G12）。
- 回滚：V11 表独立 DROP；审批/评测端点 revert；OM term 可 soft delete；评估/构建链路零触碰。

## 六、延后清单

- LLM 语义级 Faithfulness；Agent Eval；评测结果自动反馈 Recipe（G12 飞轮）
- SERVING 发布编排与通知（G12）
