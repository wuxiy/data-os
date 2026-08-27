# G10 验收报告：RAG 数据集工厂 — 2026-08-27

对照方案 `docs/ai-ready-g10-review-and-plan-20260827.md`。结论：**8/8 通过**。
`Trusted Document → Recipe → 9 算子加工 → chunks（Doris + RustFS 三件套）→ G9 重评`
全链真实跑通；`chunk_source_attribution` 从 N/A 转 PASS，产品就绪度
**0.8385/REVIEW_REQUIRED → 0.8654/CANDIDATE**（进入认证候选）——「构建真实产物使
就绪度真实提升」的闭环故事完整成立。

## 一、验收表

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 文档解析 | ✅ | 8 篇合成 HTML 解析为结构块，标题层级与段落边界保留（pytest 断言 hypertension 篇 4 标题 3 节 + ≥5 段落；远端实跑 7 唯一文档全部进入加工） |
| A2 | Recipe 幂等 | ✅ | 同输入重跑 chunk 集合逐 id 一致（pytest）；远端第二次构建：Doris `COUNT=7/DISTINCT=7`（UNIQUE KEY 覆盖）、RustFS 产物落 **v1.0.1**（v1.0.0 不被覆盖） |
| A3 | PII/脱敏 | ✅ | 3 篇阳性文档的 3 手机号 + 3 身份证 **6/6 命中**（对 expected_phi.json sidecar 对拍）并替换 `<PHONE>/<IDCARD>` 占位；产物文本零原始 PHI 残留（逐 token 断言）；阴性篇零误伤 |
| A4 | 去重 | ✅ | 输入 8 → 唯一 7（duplicate 篇被剔，原版保留），statistics 记录 `duplicates_dropped=1` |
| A5 | chunk 质量 | ✅ | 7 chunks 全部携带 document_id/source_offset/section（探针 `unattributed_ratio=0` 实证）；长度分布报告（90-252，合成语料天然小、如实反映，无空/截断） |
| A6 | 产物完整 | ✅ | RustFS `s3://dataos-ai-data/ai-data/medical-rag-guideline/v1.0.0/`（chunks.jsonl + manifest.yaml + quality.json）；manifest 含 recipe 版本/git_commit(0db6e6c)/输入清单/privacy 口径；recipe 登记入 `ai_recipe_registry` |
| A7 | G9 联动 | ✅ | 重评 10/10 产出结论（N/A 2→1，仅剩 patient_split_leakage 待 G12）；chunk 项 PASS(0.0)；**Overall 0.8654 / CANDIDATE** 经门户 build 回写产品 v0.1.0 |
| A8 | 回归 | ✅ | ai-ready pytest 28/28（新增 9 个 builder 用例）；G9 评估既有用例零修改全绿；远端既有链路零影响 |

## 二、与方案的偏差（实施实录）

1. **工具降级的既定口径落地**（方案 G10-1，决策依据均为实测）：Data-Juicer 无
   PyPI 包且远端 GitHub 不可达；docling 依赖 122 包含 torch 全家且模型托管在
   GitHub releases。Recipe 声明完全对齐架构 §10，执行器为自研 9 算子
   （语义与 §9.1 流程逐项对应）；网络恢复后可替换后端而 Recipe 不变。
2. **PII 算子缺陷（自测发现）**：18 位身份证内含的 11 位子串会被手机号 regex
   误命中（3 篇阳性多报 3 命中）——修复为**先剥身份证再匹配手机号**，统计与
   替换同序；pytest 对拍锁定。
3. **去重保留方向缺陷（自测发现）**：字母序使 `*-duplicate` 排在原版前，会把
   原版当重复丢弃——排序键加 `("duplicate" in name)` 使原版确定性保留。
4. **写入账号设计疏漏**：builder 首版复用只读评估账号 `dataos_om_ro` 被 Doris
   正确拒绝（LOAD denied）——补专用 `dataos_ai_writer`（仅 dataos_ai 库
   LOAD + compute group USAGE〔G6 同坑〕），口令 0600 文件 + .env，评估/写入
   两面分离。
5. OpenLineage 构建事件未做（既定延后，方案 G10-8）。

## 三、部署面留档

- 镜像 `ai-ready-service:0.1.0-dev`（含 ai-data 语料与 recipe）；compose 增
  RustFS 凭据、`DORIS_AI_WRITER_PASSWORD`、`DATAOS_AI_BUCKET=dataos-ai-data`
  （bucket 由 builder 自举创建）。
- Doris：`dataos_ai.chunks`（UNIQUE KEY 幂等）+ 双账号授权（om_ro 读 / ai_writer 写）。
- 产物：RustFS v1.0.0 与 v1.0.1 两版并存（版本不可覆盖实证）；Doris 7 chunks。
- 产品「临床指南 RAG 语料库」v0.1.0 readiness = 0.8654/CANDIDATE（10 项报告）。

## 四、延后清单（进入 G11）

- Docling/Data-Juicer 真实后端（网络恢复后替换执行器，Recipe 不变）
- PDF/DOCX 解析；向量索引与检索验证生产化；chunk 的 LLM 语义评测（G11）
- G11：评测与认证闭环（RAG Eval 合成集 + 人工审批流转 + 回写 OpenMetadata）
