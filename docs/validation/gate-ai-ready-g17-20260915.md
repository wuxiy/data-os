# Gate：AI-1（6C 检查项补厚）+ AI-2（真实采集语料入链）——G17 验收

> 2026-09-15。方案：docs/ai-ready-g17-review-and-plan-20260915.md（四问拷问析出的
> backlog AI-1/AI-2，用户明示执行）。口径：机制就绪、证据真实、边界诚实。
> dev 运行态：control-plane / ai-ready-service 双镜像 `0.2.0-g17-20260915`。

## 一、验收结论

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| A1 | AI-1 检查项补厚（10→14） | ✅ | 4 新检查项 + 2 口径修正全部实测通过（§二）；本地 ai-ready 56/56、control-plane 212/212 |
| A2 | 治理修复（飞轮证据→修复→重评） | ✅ | OM 补 31 表 + 13 列描述（om-prepare 幂等执行）；semantic_documentation 0.225→1.0；icd 可解析率 0.8421→0.9886（PASS）；freshness 重绑活跃链路 291.99h（PASS，dev 口径 720/2160h）；修复前基线 0.6154/FAIL → 修复后 1.0/CANDIDATE |
| A3 | 真实语料构建 | ✅ | Recipe `ep-prescription-rag-v1`（source.kind=doris_table）：2,000 处方采样 → 33 重复剔除 → **1,967 chunk**，质量通过率 100%（长度 170–339，全在窗口），**PII 命中 0**；Doris `dataos_ai.chunks_ep` + RustFS `ai-data/ep-prescription-rag/v1.0.0` 双落，版本只增不改语义复验 |
| A4 | 6C 评估（补厚后全 14 项） | ✅ | 经控制面 build：**Overall 1.0 / CANDIDATE**；14 项中 13 PASS + patient_split_leakage 维持 N/A 占位（既定口径） |
| A5 | RAG 评测 + 评测集 | ✅（三轮演进留证） | v1 问句（科室+药品）：MRR 0.1394——真实数据同科室同药并存，期望文档不可判；v2 加日期：0.2073；v3 加（日期,科室,药品）三元组唯一性筛：**recall@5 0.85 / MRR 0.6575**（ORDER BY chunk_id 后两轮复跑同值，确定性复现）。评测集 60 问入仓（零患者标识：手机号/身份证模式 0 命中） |
| A6 | 认证→服务 | ✅ | 认证请求（CANDIDATE 守卫放行）→ 人工审批 APPROVED → **CERTIFIED → SERVING**；overview：products=3 / serving=2 / latestMrr=0.6575 / averageOverall=0.9327 |
| A7 | 隐私对拍 | ✅ | ①构建期 pii_detection/deidentification 算子命中 0；②chunks_ep 全表 REGEXP 扫描：手机号/身份证模式 **0/1,967**；③PHI 列排除在 SELECT 层由构造保证（HZXM/LXFS/KH/KLX/PATIENT_ID/JZLSH/医生/BIZ_NO 不入查询与文本，测试锁定） |
| A8 | 双产品契约 | ✅ | /evaluate 按版本 recipeRef 解析 Recipe 的 doris_table+eval_file（ep-prescription-rag-v1 → chunks_ep + ep 评测集）；recipeRef 缺省回落默认（契约测试锁定，旧产品行为不变） |
| A9 | H2 遗留断链修复 | ✅（实测发现） | 控制面→引擎只透传静态令牌、引擎 S7 后只认 OIDC——compose 补 OIDC 三件套（DATAOS_AI_READY_OIDC_TOKEN_URI/CLIENT_ID/CLIENT_SECRET），修复前 401、修复后 200。该链路自 G12 后未复测，G17 全链实测踩出 |

## 二、AI-1：14 项检查终态（dev 实测 2026-09-15）

| 检查项 | 维度 | 状态 | 实测值 | 备注 |
|---|---|---|---|---|
| data_completeness | clean | PASS | 0.0 | |
| mpi_confidence | clean | PASS | 0.9799 | |
| icd_mapping_coverage | clean | PASS | 0.9886 | 口径演进：YPBM 非空率→可解析率（drug_catalog 按通用名解析）；不可解析残量 140 行为模拟轮测试占位药名，如实留证 |
| data_freshness | current | PASS | 291.99h | 重绑活跃链路（SeaTunnel→ep_mz_cfzb.UPDATE_TIME）；dev 测试源口径 30/90 天（源活动窗口截至 2026-09-03），生产另立 SLA |
| semantic_documentation | contextual | PASS | 1.0 | om-prepare 补 31 张 G16 表后 40/40 |
| column_description_coverage | contextual | PASS | 1.0 | 新探针；13 核心列描述补齐 |
| chunk_source_attribution | consumable | PASS | 0.0 | |
| chunk_deduplication | consumable | PASS | 0.0 | |
| chunk_quality_share | consumable | PASS | 1.0 | chunks_ep 1,967/1,967；空表判 0（COALESCE 修正后） |
| lineage_completeness | correlated | PASS | 1.0 | |
| ep_lineage_registration | correlated | PASS | 1.0 | 2 条列级血缘边（OM Superset 连接器捕获的分析消费面） |
| pii_classification | compliant | PASS | 1.0 | |
| deidentification | compliant | PASS | 0.0 | |
| patient_split_leakage | compliant | N/A | — | medical-training 数据工厂未建（G12 既定占位），不造空头检查 |

## 三、AI-2：语料口径与诚实边界

- **数据源**：EP 域 DM 测试库经 SeaTunnel 真实采集链路入仓（G16b/c/d 的 ods_ep 36 表）。
  外部效度主张 = 引擎/构建/评测/审批面对**真实管道数据的不完美**（16% 编码缺口、测试占位
  药名、同科室同药孪生处方），非「真实生产患者数据」。
- **precision@5 = 0.17 的解释**：行级语料中同日同科室的其他处方会进入 top5——对「单处方
  指向检索」属固有形态，MRR/recall 为主要指标；聚合式问答需上层检索产品承担。
- **评测集饱和**：近窗口处方集中于常用药，无歧义三元组去重后 60 问（全语料可支撑量级）。

## 四、工程坑入档（复用价值）

1. **正则灾难性回溯**：`(?:.*?，){2,}用药 \d+ 天` 形态在「首条目缺用药天数+后续有」的
   真实处方上组合爆炸（1,967 行语料第 280 行起挂死）——定界符线性匹配（`[^；]+`）替代。
2. **空表 SUM NULL**：chunks_ep 建表未构建时 `SUM` 返回 NULL → 探针异常 FAIL 而非指标 0；
   COALESCE 收口（表存在即产物面在册，空产物是真缺陷，应报 0.0）。
3. **评测确定性**：/evaluate 语料查询无 ORDER BY 时 BM25 同分破平按表返回序，MRR 有
   ±0.01 抖动——ORDER BY chunk_id 后两轮复跑同值。
4. **Doris LENGTH 字节口径**（沿用 G16 结论）：合成语料 8 chunk 全 0.5 的成因之一；
   EP 语料按字符窗口（min 50）全数通过。

## 五、未竟与去向

- patient_split_leakage 维持 N/A 占位（training 数据工厂未建，后续 G 候选）；
- Data-Juicer 真实引入维持条件挂起（四问口径不变）；
- freshness 生产 SLA：生产接入持续流量后另立（requirement.yaml 版本化变更）；
- 检查项继续补厚的下一批候选（Contextual 加 FHIR/LOINC、Current 加 SLA 检测）按需记 backlog。

## 六、测试与提交基线

- ai-ready-service 56/56（新增：表源构建 5、评测集生成器 5、/evaluate 契约 2、目录形状 1）；
- control-plane 212/212（新增 evaluatePassesCurrentVersionRecipeRefToEngine）；
- 提交链：be42e18（计划）→ ed26e0f（AI-1）→ aa0b009（AI-2）→ 18ce182（空表 SQL）→
  af74f44（评测集判别+OIDC 三件套）→ b06deba（评测集入仓）→ 8b89a33 前（确定性 ORDER BY）；
  dev 双镜像 0.2.0-g17-20260915（.env 钉 tag，备份 .env.pre-g17-20260915）。
