# G10 RAG 数据集工厂方案 — 2026-08-27

> 前置：架构 §9.1（RAG 加工流程）/§10（Recipe 化）/§12-13（Manifest/Version）、
> G8（AI Data Product 域）/G9（评估引擎，`requires_table` 机制已留位）。

目标：跑通 `Trusted Document → Recipe → Build → Chunks → 评估` 完整链路，产出
第一条 Medical RAG Corpus（合成医疗文档），`chunk_source_attribution` 探针从
N/A 转为真实生效，G9 评估覆盖 10/10。

## 一、现状事实（2026-08-27 实测）

| # | 事实 |
| --- | --- |
| 1 | **Data-Juicer 无 PyPI 包且远端 GitHub 不可达**（ls-remote 超时）——源码安装不可行 |
| 2 | **docling 可达但依赖 122 包**（torch/torchvision/transformers/accelerate），且其布局/表格模型从 GitHub releases 拉取——同样被网络卡死；完整安装镜像将膨胀数 GB |
| 3 | PyPI 可达（pip install 正常）；Doris/RustFS 凭据齐备（`.env`）；G9 引擎的 `requires_table: dataos_ai.chunks` 声明已在位（表存在即自动生效） |
| 4 | G8 Recipe 三表之一 `ai_recipe_registry` 已建（G8 V10），登记接口待用 |

## 二、设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| G10-1 | **工具降级、规范不降级**：Recipe 声明完全对齐架构 §10（apiVersion/kind/spec.pipeline 算子名）；执行器为自研轻量算子（`services/ai-ready-service/rag_builder/`），算子语义与 Data-Juicer 对应（结构化 pipeline 逐算子实现）。Docling/Data-Juicer 引入延后——Recipe 不变，执行器后端可替换（这正是 Recipe 化的架构意义） | 网络/体积硬约束；「不把工具不可用当功能缺失」——链路、产物、评估三面验收全部真实 |
| G10-2 | 合成文档集 `ai-data/documents/`（进 Git）：8 篇 HTML 医疗文档（指南/制度/须知），**3 篇含 PHI 阳性样本**（合成姓名/手机号/身份证，标注于 sidecar `expected_phi.json` 供脱敏验收对拍），1 篇为重复文档（验去重） | 合成口径（用户拍板）；PHI 阳性/阴性兼备使 pii/deidentification 算子可验 |
| G10-3 | Recipe `ai-data/recipes/medical-rag-v1.yaml`；构建入口 `python -m app.rag_builder --recipe ai-data/recipes/medical-rag-v1.yaml`（容器内执行）：document_parse(HTML→结构文本) → text_normalization → template_removal → deduplicate(hash) → pii_detection(regex) → deidentification(占位替换) → semantic_chunk(段落感知+目标窗口+overlap，标题层级保持) → chunk_quality_score(规则分) → metadata_enrichment(document_id/source_offset/section) | 架构 §9.1 流程逐项落地 |
| G10-4 | 产物双落：Doris `dataos_ai.chunks`（UNIQUE KEY(chunk_id) 幂等重跑覆盖）+ RustFS `ai-data/medical-rag-guideline/v{semver}/{data/chunks.jsonl, manifest.yaml, quality.json}`；**版本不可覆盖**：构建时若对象已存在则递增版本（v1.0.0 已存在 → 写 v1.0.1），manifest 记录 recipe/git_commit/输入清单/算子统计 | 架构 §13「产物只增不改」 |
| G10-5 | `manifest.yaml` 对齐架构 §12 字段子集（workload/source/privacy/lineage.recipe/git_commit）；`quality.json` 承载算子统计（去重数/PII 命中/脱敏数/chunk 分布） | 可追溯与可验收 |
| G10-6 | G9 联动：chunks 表落库后重跑 assess——`chunk_source_attribution`（无 document_id/source_offset 的 chunk 占比）真实评估；新增 recipe 登记进 `ai_recipe_registry`（幂等 SQL） | 闭环「构建→评估」 |
| G10-7 | builder 集成进 ai-ready-service 容器（同一 Python 服务，无新部署面）；CLI 子命令 + 独立模块，不碰评估链路代码 | 最小运维面 |
| G10-8 | OpenLineage 事件**本批不做**（OM 1.5 事件面在 G7 已知有缺陷），血缘以 manifest.lineage + recipe 登记承载；记入延后 | 真实约束 |

## 三、实施步骤

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| E1 | 合成文档集（8 HTML + expected_phi sidecar + 1 重复篇） | 文件进 Git；PHI 样本可机器对拍 |
| E2 | rag_builder 模块（算子 9 个 + Recipe 加载 + Doris/RustFS writer）+ 单测（去重/PII 对拍/幂等/版本递增/chunk 质量） | pytest 全绿 |
| E3 | Doris `dataos_ai` 库 + chunks 表 DDL（deploy 脚本，幂等） | 建表留证；UNIQUE KEY 验证 |
| E4 | 远端：镜像重建 → builder 实跑 → chunks 落库 + RustFS 产物 + recipe 登记 → G9 assess 重跑 | 10/10 生效；chunk 项 PASS；Overall 更新 |
| E5 | 门户可见性（build 后 readiness 含 chunk 项）+ 截图；幂等重跑（同输入同 chunk 集合、版本不覆盖时递增） | 实测 + 截图 |
| E6 | gate 报告 + 提交推送 + 记忆 | 报告落库 |

## 四、验收清单（gate）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| A1 | 文档解析 | 8 篇 HTML 解析为结构文本，标题/段落/列表结构保留（抽查断言） |
| A2 | Recipe 幂等 | 同输入重跑：chunk 集合逐字节一致（UNIQUE KEY 覆盖，行数不变）；RustFS 已存在版本不被覆盖（递增 v1.0.1） |
| A3 | PII/脱敏 | 3 篇阳性文档的合成手机号/身份证 100% 命中并替换为占位符（对 expected_phi.json 对拍）；阴性篇零误伤 |
| A4 | 去重 | 重复文档被剔除（输入 8 → 唯一 7），statistics 记录 |
| A5 | chunk 质量 | 全部 chunk 携带 document_id/source_offset/section（溯源完备）；长度分布报告；无空/截断 chunk |
| A6 | 产物完整 | manifest.yaml（recipe 版本/git commit/输入清单）+ quality.json（算子统计）+ chunks.jsonl 三件套落 RustFS；目录结构符合 §13 |
| A7 | G9 联动 | 重跑 assess：chunk_source_attribution 生效（unattributed_ratio=0 → PASS）；Overall 与 gate 结论更新并回写产品版本 |
| A8 | 回归 | ai-ready pytest（新增 builder 用例）+ 引擎评估既有用例全绿；既有链路零影响 |

## 五、边界与回滚

- 不做：真实院方文档、PDF 解析、向量索引、LLM 语义分、OpenLineage 事件（延后）。
- 回滚：`dataos_ai` 库独立 DROP；RustFS `ai-data/` 前缀删除；rag_builder 模块 revert；评估面自动回落 N/A。

## 六、延后清单

- Docling/Data-Juicer 真实引入（网络恢复后替换执行器后端，Recipe 不变）
- PDF/DOCX 解析；嵌入与向量索引生产化；chunk 的 LLM 语义评测（G11 部分）
- OpenLineage 构建事件；medical-training 数据工厂
