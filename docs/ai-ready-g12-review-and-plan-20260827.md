# G12 数据飞轮与门户收口方案 — 2026-08-27

> 前置：G8（域对象/生命周期）、G9（评估）、G10（构建/chunks）、G11（评测/审批/
> CERTIFIED）；架构 §28（飞轮）、§36（Dashboard 指标）；总计划 Gate 12（收官批）。

目标：打通 `Failure Sample → Feedback → 新版本 → 重建 → 重评 → 发布` 的数据飞轮
闭环（合成场景实测、分数提升可证），补 SERVING 发布守卫，门户 AI Data 工作台
收口（Dashboard 指标 + Feedback 队列），文档与复盘定稿——G8-G12 主线收口。

## 一、设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| G12-1 | **Feedback 域**（Learning Plane）：V12 `ai_evaluation_feedback`（锚定评测明细：question/metric/outcome/feedback_type/status）；feedback_type ∈ `CHUNK_QUALITY/MISSING_DOC/DEID_OVERREACH/LABEL_ERROR/OTHER`；status ∈ `CREATED→CONSUMED/DISMISSED`；API：提交/列表/处置。**候选不自动上线**：feedback 仅驱动人工发起的新版本 | 架构 §28；与 MPI Learning Plane 同思想（G12 计划既定） |
| G12-2 | **飞轮闭环真实演示**（一条全链，分数提升可证）：G11 实测 Faithfulness=0.3（失败样本在册）→ 对失败问提交 feedback（CHUNK_QUALITY）→ 处置为 CONSUMED 并据此**补语料**（新增一篇覆盖失败问域的文档）+ **调 chunk 参数**（recipe v1.1：target_chars 900→600，段落完整性提升）→ builder 重建 → `registerVersion("v0.2.0")` → re-assess + re-evaluate → **MRR/Faithfulness 提升实测对比** | 全链真实（无一处写死分数）；「失败样本驱动版本改进」的口径可复现 |
| G12-3 | **SERVING 发布守卫**：transition 到 SERVING 时校验存在该产品 **APPROVED** 审批记录（状态机已限 CERTIFIED→SERVING，补审批证据校验）——未认证不得发布 | 架构生命周期口径 |
| G12-4 | **Dashboard 指标**：BFF 轻聚合端点 `GET /ai-data-products/overview`（产品总数/CERTIFIED 数/平均 Overall/最新评测 MRR 与 Recall/feedback 待处理数——§36 指标的首批子集，聚合自现有表）；门户 `/ai-data` 顶部指标带 + Feedback 队列段（产品详情内，处置按钮） | 前端不多发请求；指标可计算可解释 |
| G12-5 | 版本时间线：详情页版本表已含 readiness/evaluation 列——本批补**版本间对比视图**（v0.1.0 vs v0.2.0 的 Overall/MRR/Faithfulness 变化行） | 飞轮「分数提升」的呈现面 |
| G12-6 | 文档收口：CONTEXT.md 术语定稿（补「认证审批」「评测反馈/数据飞轮」）；tasks/lessons.md 增 G8-G12 复盘段；AGENTS.md 已注册（G9）核对待办 | 总计划既定 |

## 二、实施步骤

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| E1 | V12 + feedback 域（record/repo/service/controller）+ mvn 用例 | 提交/列表/处置/状态机（CREATED 才可处置）全绿 |
| E2 | SERVING 守卫 + overview 聚合端点 + mvn 用例 | 无 APPROVED 记录 SERVING 409；overview 数值对拍 |
| E3 | 前端：指标带 + Feedback 队列（提交/处置）+ 版本对比 + vitest | 全绿；demo 零改动 |
| E4 | 远端飞轮实测：feedback → recipe v1.1 + 补语料 → 重建 → v0.2.0 → 重评/重评 → 分数提升对比留证 → SERVING 发布 → 负向（新产品无审批直接 SERVING 409） | 全链截图/数值 |
| E5 | 文档收口（CONTEXT/lessons）+ 全量回归（pytest/mvn/前端/OM 对账） | 全绿 |
| E6 | gate 报告 + 提交推送 + 记忆 | 报告落库 |

## 三、验收清单（gate）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| A1 | 飞轮闭环 | 失败样本（G11 Faithfulness 0.3 实测在册）→ feedback → 处置 CONSUMED → 语料/参数调整 → v0.2.0 → 重评：**Overall 与评测指标提升，前后对比数值留证** |
| A2 | 候选不自动上线 | feedback 处置只改状态；新版本/recipe 变更均人工触发；v0.2.0 需人工 build/evaluate |
| A3 | SERVING 守卫 | 有 APPROVED 审批 → SERVING 成功；无审批产品（负向）SERVING 409 |
| A4 | Dashboard | overview 端点数值与表内对拍；门户指标带 + Feedback 队列真实渲染 |
| A5 | 文档一致 | CONTEXT 术语与实现一致；lessons 复盘落档；AGENTS 无漂移 |
| A6 | 回归 | pytest / mvn / 前端全绿；OM 三库对账零差异；既有链路零影响 |

## 四、边界与回滚

- 不做：Label Studio、真实用户反馈采集通道、Agent Eval 趋势、评测自动触发 recipe 变更。
- 回滚：V12 表独立 DROP；feedback/overview 端点 revert；语料新增文件与 recipe 版本只增不改。

## 五、延后清单（G12 后）

- medical-training 数据工厂 / patient_split_leakage 生效；真实 LLM Faithfulness；Agent Eval
- OM term 回写（实例修复后）；ToB 数据 API（G13 候选）；MPI 算法效果（G14 候选）
