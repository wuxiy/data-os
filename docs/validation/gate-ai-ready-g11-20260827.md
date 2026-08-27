# G11 验收报告：评测与认证闭环 — 2026-08-27

对照方案 `docs/ai-ready-g11-review-and-plan-20260827.md`。结论：**5/6 通过、
1 项部分交付**——评测面与认证审批闭环全链真实跑通（含两条实施期发现并修复的
真实缺陷）；OM 回写因**实例级端点缺陷**降级为部分交付（glossary + 分类/标签
就绪，term 写入受阻并归档缺陷证据）。

## 一、验收表

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 评测可复现 | ✅ | 远端两次 evaluate 逐指标一致：Recall@5=1.0、MRR=0.95、Citation=0.9、Faith=0.3（10 问合成集）；每问命中明细（期望/实际/名次/引用/忠实）在引擎响应与 pytest 固定用例中可解释——忠实度 0.3 为规则版口径的真实反映（golden 句需逐字出现在 top1 片段） |
| A2 | 认证全流程 | ✅ | 远端实测：ASSESSED → 提交审批（PENDING，快照 0.8654/CANDIDATE）→ 批准 → **CERTIFIED**（审批人/时间入 V11 表）；拒绝路径与原子性由 mvn 用例锁定（审批事务回滚语义经远端复验） |
| A3 | 负向守卫 | ✅ | 直通 CERTIFIED 409（提示走审批）；CERTIFIED 态重复提交 409；已处理请求重复审批 409；未评估提交 409；BLOCKED/非 CANDIDATE 提交 409（pytest 覆盖）——其中「CERTIFIED 态可重复提交」为**实施期发现的真缺陷**，补 ASSESSED 态守卫修复 |
| A4 | OM 回写 | ⚠️ 部分 | glossary「AI 数据产品」+ AIReadiness 分类 + 4 状态标签入库（幂等脚本两跑验证，`/tags` 页可见，截图归档）；**term 写入受阻**：POST glossaryTerms 报 `glossary instance for <id> not found`（按 id 引用解析失败）——本 OM 实例级缺陷（与 G7 testDefinitions 端点损坏同源，已并入备忘 P3）；标签打 term 依赖 term，一并受阻 |
| A5 | 门户口径 | ✅ | 评测五指标段（Recall/MRR/Citation/Faith）、认证审批表（提交人/审批人/操作按钮按状态显隐）、已认证状态标签真实渲染；demo 零改动；截图归档 |
| A6 | 回归 | ✅ | pytest 33/33（评测 5 用例）；mvn 全量零失败（审批 6 用例，G8 用例随守卫语义更新）；前端 tsc/vitest/qa/build 全绿；OM 三库对账零差异 |

## 二、与方案的偏差（实施实录）

1. **审批面两个真缺陷（自测/实测发现）**：① CERTIFIED 态可重复提交审批（补
   ASSESSED 态守卫，含校验顺序修正：先 readiness 后状态，使「尚未评估」
   诊断优先）；② 引擎评测 SQL 库名笔误 `data_os_ai`（正确 `dataos_ai`）。
2. **V11 迁移真 PG 类型坑**：`DOUBLE` 在 PostgreSQL 不存在（须 `DOUBLE
   PRECISION`），H2 PostgreSQL 模式宽容掩盖——首次远端启动 Flyway 失败，
   修复后 Flyway 自动恢复 failed entry 重跑。
3. **OM term 端点缺陷（实例级，非配置可解）**：三层穿透——POST 缺
   description 报 400（补齐后）→ `glossary instance not found`（按 id 引用
   解析失败，最小化重试钉死）→ PATCH glossaryTerms 405。连同 G7 的
   testDefinitions 损坏归档为同一实例病灶（备忘 P3），OM 升级评估的必要性
   再添一证。
4. 排障链中的可复用坑：URL quote 修复误伤 query string（`?limit=` 被编码致
   列表全空 → 误判不存在 → POST 409）；term name 含空格时 fqn 归一化使
   GET/POST 不一致（slug 化解决）；**control-plane 容器重建后必须 restart
   portal**（nginx 缓存上游 IP，G9 坑复现两次）。
5. 评测集（10 问自然语言）从 G10 真实 chunks 锚定生成（期望 document_id 为
   内容指纹，确定性）；Faithfulness 为规则版（LLM 语义级延后，方案既定）。

## 三、部署面留档

- control-plane `0.1.0-ai-ready-g11-20260827`（含 V11 与守卫）；ai-ready-service
  含 evaluation 模块；portal-dist 已更新。
- 产品「临床指南 RAG 语料库」：CERTIFIED（审批记录 V11 表）；版本 v0.1.0
  readiness 含 evaluation 段（MRR 0.95 等）。
- OM：glossary `ai-data-products`、分类 `AIReadiness`（4 标签）留存；探针
  glossary 已清理。

## 四、延后清单（进入 G12）

- OM term 回写（实例修复/升级后启用，脚本 best-effort 段就位）
- LLM 语义 Faithfulness、Agent Eval、评测结果反馈 Recipe（G12 飞轮）
- SERVING 发布编排与通知（G12）
