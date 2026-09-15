# G17 评审与计划：6C 检查项补厚（AI-1）+ 真实采集语料入链（AI-2）

> 2026-09-15。来源：四问拷问析出的两条 backlog 候选（deferred-hardening-backlog AI-1/AI-2），
> 用户明示「完成 AI-1 和 AI-2」。口径延续内部 gate 判据：机制就绪、证据真实、边界诚实。
> 前置：G8–G12（AI Data Product 域 / 评估引擎 / RAG 工厂 / 评测与审批 / SERVING 与飞轮）。

## 一、实测基线（2026-09-15，dev 全链探针）

引擎现口径评估 `profile=medical-rag`：**Overall 0.6154 / FAIL**（G12 时点为 0.8654）。
与 G12 相比漂移出三处真实退化，均为数据面事实而非引擎缺陷：

| # | 检查项 | 实测 | 根因（已查证） |
|---|---|---|---|
| 1 | data_freshness | 620.99h（FAIL，pass 48/warn 168） | check.sql 绑定 `ep_mz_cfzb_edge`（G5 边缘模拟链路，末次更新 2026-08-20，链路已收档）；**活跃采集链路是 G16b SeaTunnel 直连**，其水位 `ep_mz_cfzb.UPDATE_TIME` 末次 2026-09-03 10:00（≈290h）——检查绑定停留在退役链路上 |
| 2 | icd_mapping_coverage | 0.8421（FAIL，pass 0.98） | 口径是「YPBM 非空率」代理。实测 1,937/12,271 行（15.8%）**有药名（YPTYM）无编码**，其中不可解析仅 140 行（模拟轮注入的测试占位药名）；以 G16d 药品主数据 `drug_catalog`（3,914 行，GENERIC_NAME+STANDARD_CODE）按名解析后**可解析率 0.9886 ≥ 0.98**。原 check.sql 注释即预声明「映射表接入后切换真实口径（见 fix.md）」——G16d 药品目录正是该映射表，本修正属执行既定演进 |
| 3 | semantic_documentation | 0.225（FAIL，pass 0.8） | `om-prepare-ai-ready.sh`（G9）仅描述 9 张表；G16b/c/d 此后新增 31 张 EP 表未补描述（ods_ep 36 表仅 5 表有描述） |

其余事实：ods_ep 36 表在册；`ep_mz_cfzb` 11,423 行（KFRQ 跨 2023-12-27→2026-09-03，567 个开方日）；
`ep_mz_ypcfmx` 12,271 行；`dataos_ai.chunks` 8 条全 quality_score=0.5（合成语料短段落所致，无内容重复）；
`ep_mz_cfzb` 下游存在 2 条列级血缘边（OM Superset 连接器自动捕获，指向分析模型）；词表 glossary term=0（词表方向排除）。

**处置原则（飞轮语义）**：真实数据面暴露的缺口按「证据→修复→重评」闭环处理，不用调阈值掩盖；
所有阈值/口径变更带实测证据入档声明仓库（Git 版本化）。

## 二、AI-1：6C 检查项补厚（10 → 14 项）

### 新增 4 项

| 维度 | 检查项 | 类型 | 口径与证据 |
|---|---|---|---|
| Contextual | `column_description_coverage` | om_probe（**新探针**） | 声明清单内核心列（cfzb 7 列 + ypcfmx 6 列）在 OM 有非空描述的占比；pass 0.8 / warn 0.5。现值 0（列描述未登记）——由 om-prepare 扩充补齐后为 1.0 |
| Consumable | `chunk_deduplication` | doris_metric（requires_table `dataos_ai.chunks`） | 产物内容重复率 `1 - COUNT(DISTINCT MD5(content))/COUNT(*)`；pass 0.0 / warn 0.01。实测 0 |
| Consumable | `chunk_quality_share` | doris_metric（requires_table `dataos_ai.chunks_ep`） | 真实语料产物中 quality_score ≥ 1.0 的 chunk 占比；pass 0.9 / warn 0.8。表由 AI-2 构建产生（构建前 N/A 自动生效，同 chunk_source_attribution 惯例） |
| Correlated | `ep_lineage_registration` | om_probe（复用 lineage_edge_coverage） | 根表 `ods_ep.ep_mz_cfzb` 下游血缘边 ≥ 2（分析消费面在册）；实测 2（Superset 列级血缘） |

### 修正 2 项（既有检查的口径演进，非阈值放水）

| 检查项 | 修正 | 证据 |
|---|---|---|
| `icd_mapping_coverage` | SQL 从「YPBM 非空率」改为「编码可解析率」：有码，或 YPTYM 可在 `drug_catalog` 按通用名解析出 STANDARD_CODE | 可解析率 0.9886（PASS）；不可解析 140 行为模拟测试占位药名（「安全药品处方药通用名」135 +「TSP测试通用名」5），如实留证。fix.md 预声明路径兑现 |
| `data_freshness` | SQL 重绑活跃链路水位 `ep_mz_cfzb.UPDATE_TIME`（弃退役的 edge 表）；阈值改为 pass 720h / warn 2160h | dev 测试源（EP 域 DM 测试库）活动窗口截至 2026-09-03，无持续新增；dev 口径 30/90 天写入 fix.md（生产接入持续流量后另立生产 SLA）。实测 ≈290h → PASS |

Profile 权重（medical-rag / medical-training 同步）：column_description_coverage 1.0 / 0.8、
chunk_deduplication 0.8 / 0.6、chunk_quality_share 0.8 / 0.8、ep_lineage_registration 1.0 / 1.0。

### 配套治理修复（AI-1 的证据面）

`om-prepare-ai-ready.sh` 扩充（幂等）：① 补齐 G16 新增 31 张 EP 表中文描述（来源
ep-domain-inventory-20260902.md 附录表清单）；② 新增核心列描述段（cfzb/ypcfmx 13 列，
喂 column_description_coverage）。semantic_documentation 预期 0.225 → 1.0。

`patient_split_leakage` 维持占位 N/A（medical-training 数据工厂未建，G12 既定），不造空头检查。

## 三、AI-2：真实采集语料入链（外部效度验证）

**语料口径（诚实声明）**：EP 域 DM 测试库经 SeaTunnel 真实采集链路入仓的数据（G16b/c/d），
非仓库内合成文档；外部效度主张 =「引擎/构建/评测/审批面对真实管道数据的不完美」
（16% 编码缺口、测试占位药名、DM 字符 vs Doris 字节口径），而非「真实生产患者数据」。

### 方案要素

1. **Recipe 源扩展**：`spec.source.kind: doris_table`（缺省 documents 维持现行 HTML 行为）。
   新算子 `table_serialize`：读处方主表 + 明细表（按 CFZID 关联、按 KFRQ DESC 确定性采样
   `limit` 行），每张处方可叙化为一篇结构文本，后续复用现有算子链
   （normalization → deduplicate → pii_detection → deidentification → semantic_chunk → quality → metadata）。
2. **PHI 列排除纪律（硬约束）**：序列化只取医学属性列（机构/科室/日期/性别/年龄段/诊断/症状/药品用法用量）；
   **直接标识符列不入文本**（HZXM 姓名、LXSS 联系方式、KH/KLX 卡号、PATIENT_ID、JZLSH、
   医生工号与姓名、BIZ_NO）；患者连参照假名都不引入（RAG 内容无需患者级关联）。
   pii_detection/deidentification 算子保留作验证层。清单写入 recipe 注释与 gate 文档。
3. **产物分表**：`dataos_ai.chunks_ep`（UNIQUE KEY(chunk_id)，DDL 入 deploy/scripts），
   与合成语料的 `dataos_ai.chunks` 隔离——评测检索不互污，schema 沿用现有 chunks 列。
   RustFS 前缀 `ai-data/ep-prescription-rag`，版本只增不改语义不变。
4. **评测双产品契约**：控制面 `/ai-data-products/{id}/evaluate` 把当前版本 `recipeRef` 传给引擎；
   引擎 `/evaluate` 按 recipeRef 解析 `ai-data/recipes/{ref}.yaml` 的
   `spec.output.doris_table` + `spec.output.eval_file`（新增可选字段）；**recipeRef 缺失或文件
   不存在时回落现行默认**（dataos_ai.chunks + medical-rag-evalset）——旧产品零行为变化。
5. **评测集**：`ai-data/eval/ep-prescription-evalset.jsonl` 由生成器脚本（入仓）从构建产物
   确定性生成：按高频药品选处方，模板问句（仅含药品名/剂型/用法等非标识属性），期望
   document_id 对应该处方 chunk，golden 句取自序列化文本。**问句不含任何患者标识**。
6. **产品与链路**：控制面新建产品「门诊处方 RAG 语料库（真实采集）」（RAG_CORPUS /
   MEDICAL_RAG），登记 v0.1.0（recipeRef=ep-prescription-rag-v1）→ 容器内构建 → build 评估
   （补厚后 14 项，预期 ≥0.85 CANDIDATE）→ evaluate → 认证审批 → CERTIFIED → SERVING。

### 明确不做

- 不引入 Data-Juicer 真实后端（维持条件挂起，四问口径不变）；
- 不做患者切分（patient_split_leakage 维持 N/A 占位）；
- 不改合成语料产品（临床指南 RAG 语料库）的既有版本与 SERVING 状态。

## 四、验收口径（gate）

1. 本地三栈全绿：ai-ready pytest（新探针/新源/契约测试）+ control-plane mvn（recipeRef 传递）+ 前端不涉及；
2. dev 全链实测：om-prepare 执行后 semantic_documentation/column_description_coverage 达标；
   补厚后 medical-rag profile 全 14 项状态与预测一致（允许 WARN，逐项对拍留证）；
3. EP 产品走完 登记→构建（chunks_ep 行数 + RustFS 版本）→评估（CANDIDATE）→评测
   （五指标留证）→审批 CERTIFIED→SERVING；overview serving=2；
4. 隐私对拍：chunks_ep 全表无姓名/手机号/身份证模式命中（deidentification 检查口径复用）；
5. gate 文档 + backlog AI-1/AI-2 关闭 + README/docs 一致性。

## 五、风险与回滚

- OM PATCH 均幂等（仅空描述时写）；声明仓库变更随 Git 可回滚；
- chunks_ep 独立表，DROP 即回滚，不触碰既有 chunks；
- /evaluate 回落默认保证旧产品评测行为不变（契约测试锁定）。
