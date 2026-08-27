# MPI Gate 14：匹配算法效果评测与 V2 概率评分 实施计划与验收清单

> 日期：2026-08-28
> 状态：实施中（Gate 式：方案 → 实施 → 评测 → 影子对比 → gate 报告）
> 前置文档：`docs/mpi-g3-review-and-plan-20260819.md`（V1 交付与 V2+ 延后清单）
> 阶段定位：核心职责 3「完善算法效果」；备忘 T2 关闭项

---

## 一、Goal

G3 交付的是 **V1 确定性规则演示档**：规则可解释、红线立住（弱标识不单独
硬合并、人工否决最高优先级），但有两个已知缺口：

1. **无评测集**：算法效果没有可复现的量化口径（准确率/召回率无从谈起）；
2. **无阈值标定**：AUTO / REVIEW / NO_MATCH 三态边界由规则形状硬编码，
   没有「分数 + 双阈值」的标定机制。

G14 关闭备忘 T2「MPI 匹配算法效果系统性评测（准确率/召回率评测集与阈值
标定）」，交付三件事：

| # | 交付物 | 说明 |
| --- | --- | --- |
| D1 | **冻结评测集** | 真实身份快照（1433 行）派生的带标签配对语料 + 可复现生成器 + 人工裁决真实锚点 |
| D2 | **V2 概率评分器** | Java Fellegi-Sunter 评分（m/u 权重 + 姓名频率 u 细化），Hard Constraint 前置，双阈值三态 |
| D3 | **评测与标定 harness** | V1 vs V2 的 P/R/F1 + 混淆矩阵；阈值扫描（约束：评测集零错误 AUTO）；真实 45 候选对影子对比 |

**V2 上线口径：影子模式。** 决策权默认仍归 V1 规则；V2 分数写入
`mpi_match_result.evidence`（JSON 追加，无 schema 变更）。是否把决策权
切给 V2（`data-os.mpi.matcher.mode=scored`）由下个 gate 依据影子分歧
清单决定——错误合并的临床风险高于漏合并，切换不与本轮捆绑。

## 二、现状盘点（2026-08-28 实测，远端 Doris/PG）

| 面 | 事实 |
| --- | --- |
| 身份底账 | `mpi_source_identity` 1433 行，单源 EP，按 `YLJGDM+PATIENT_ID` 去重装载；contact_hash / card_no_norm 全量非空 |
| 候选召回 | 45 对（B4=42、B6=3；B3 单源恒 0） |
| V1 决策 | AUTO 8（M-ep2）/ REVIEW 33（P-ep1）+ 3（P-ep2）/ HARD_CONFLICT 1；黄金人 7 |
| 人工裁决 | 4 条 RESOLVED（2 SAME_PERSON / 2 DIFFERENT_PERSON）+ 1 次 SPLIT（即 H-ep1 来源）——真实标签锚点 |
| 字段现实 | EP 无出生日期/证件；姓名池仅 322（同名不同人是天然难负样本）；卡号复用是真实形态（33 对 P-ep1） |
| 算法资产 | `MpiRuleMatcher` v1（机构锚点 + 两类属性一致才 AUTO）；标准化 NFKC/性别 M/F/U/卡号大写/联系方式加盐 SHA-256 |
| 测试基线 | mpi-service 9 个测试类；G3 验收口径「行为保持」延续 |

## 三、架构与决策

```text
真实快照(1433) ──生成器(seed)──> 标定集 ──> m/u 估计表
                     │                        │
                     └──> 冻结评测集 ──> Java harness ──> V1 vs V2 指标 + 阈值扫描
                                                    │
人工裁决 4+1 对（真实锚点，独立小集）────────────────┤
                                                    ▼
                              V2 评分器（影子）── mpi_match_result.evidence.v2Score
```

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 评测集口径 | 真实快照 + 受控扰动半合成；**快照与语料入 Git** | EP 本身是 EP_TEST 合成演示数据（G3 已记录口径），非真实 PHI；入 Git 换可复现性。扰动模型如实写入报告 |
| 循环性防护 | 标定集与评测集**按身份不重叠划分**；标签来自生成器 ground truth 与人工裁决，绝不取自被评测规则的输出 | m/u 在 A 集估计、指标在 B 集计算，避免自证 |
| 评分器形态 | 纯 Java FS（log2 m/u 权重和），不引入 Python/Spark 在线依赖 | G3 采纳决策：「Splink 限定 Learning Plane」；1433 规模 Java 单机 harness 足够 |
| 姓名权重 | u 按姓名频率细化（322 池：u_name(i) = freq(i)），非全局常数 | 姓名池小是 EP 现实，全局 u 会系统性高估同名证据 |
| 缺失值处理 | 一侧缺失 → 该字段权重 0（无信息），非「不一致」 | 缺卡号 ≠ 卡号冲突，V1 的 P-ep2 已体现此语义，V2 保持 |
| V2 接入 | 影子：evidence JSON 追加 `v2Score`/`v2Policy`；决策列不变 | 零 schema 变更、零决策面变化；切换留 config flag |
| 阈值标定 | 网格扫描 (T_auto, T_review)，约束**评测集零错误 AUTO**下最大化 F1 | 「错误合并风险高于漏合并」的量化落地 |
| Splink/DuckDB Lab | 仍延后（不建 mpi-lab 目录） | 规模不匹配：引入成本 > 收益；规模化时再启 |

**V2 比较向量（Comparison Vector）**：institution（exact）、card
（agree / one-missing / disagree）、name（exact / JW≥0.9 变体 / disagree）、
gender（agree / U 缺失 / disagree）、contact_hash（agree / one-missing /
disagree）。m 从标定集正样本一致率估计；u 从随机负样本对 + 姓名频率估计。

**扰动模型（正样本，贴合 EP 真实脏形态）**：同身份生成第二登记——
联系方式变化或缺失（换号/漏登记）、卡号一侧缺失（补登记）、性别一侧
录为 U；姓名保持精确（EP 无变体空间，变体通道由 JW 比较器覆盖但不生成）。
**负样本**：同名同性别同机构不同人（难负）、同卡不同人（EP 真实形态）、
随机对不同人（易负，供 u 估计）。

## 四、任务分解

| Phase | 内容 | 验收 |
| --- | --- | --- |
| P1 评测集 | `services/mpi-service/eval/`：快照导出、生成器（seed 固定）、冻结语料（calibration/eval/anchors 三文件） | 语料入 Git；重跑生成器结果逐字节一致；标定/评测身份零交集（脚本自检） |
| P2 评分器 | `matcher/MpiScoreMatcher`（FS 权重 + 双阈值 policy）+ 单测 | mpi-service 全量 mvn test 全绿；边界（缺卡/缺联系方式/U/同名不同人/同卡不同人）覆盖 |
| P3 harness | 测试域 Java harness：读冻结语料 → V1/V2 指标 + 阈值扫描报告（JSON 到 eval/reports/） | V1 指标可解释（预期：召回受 B6' 收紧限制）；V2 评测集 F1 ≥ V1 且零错误 AUTO；阈值定版 |
| P4 影子接入+dev | `MpiDecisionService` evidence 追加 v2Score/v2Policy；构建镜像、dev 部署、真实 45 对影子打分、对比报告 | 决策分布与 V1 基线完全一致（8/33/3/1）；evidence 含分数；分歧清单人工可读 |
| P5 收尾 | gate 报告、方案验收结论、backlog T2 状态、推送、记忆 | 全链绿灯 |

## 五、验收清单

1. 冻结评测集入 Git（生成器 + seed + 快照 + 三语料文件），重放一致；
2. m/u 估计表输出（各字段 m/u 数值与数据依据），标定/评测分离自检通过；
3. `MpiScoreMatcher` 单测全绿（含全部边界），mpi-service 既有测试零修改；
4. harness 输出 V1 与 V2 的 P/R/F1 + 混淆矩阵（冻结评测集），数字入报告；
5. 阈值扫描选定 (T_auto, T_review)，满足评测集零错误 AUTO，扫描表入报告；
6. 人工裁决 4+1 真实锚点：V1 与 V2 判定对照表（V2 不得错判锚点为 AUTO）；
7. dev 真实数据：45 候选对全部带 v2Score，决策分布与 V1 基线一致；
8. V1/V2 分歧清单（若有）逐条有人工可读解释；
9. gate 报告 `docs/validation/gate-mpi-g14-*.md` + backlog T2 状态更新 + 记忆。

## 六、延后项（本批不做，归备忘）

| 项 | 处置 | 恢复时机 |
| --- | --- | --- |
| Splink/DuckDB mpi-lab | 不建 | 数据规模/源数增长时 |
| 决策权切换 scored 模式 | 影子先行，flag 已留 | 下个 gate 依分歧清单裁决 |
| V3 监督 ML / mpi_label 表 | 人工裁决继续落审计，暂不回填 | V3 |
| Champion/Challenger/Drift 框架化 | 最小影子实现（evidence 并列）替代 | V4 |
| FHIR $match | 不做 | 后续 |
| 阈值在线再标定（数据漂移检测） | 冻结阈值 + 重跑 harness 的人工触发口径 | V4 |

## 七、风险与口径如实

- **半合成局限**：扰动模型是受控假设，不代表真实脏数据全分布——报告
  明写「评测数字在扰动模型内有效」，真实面以影子分歧清单 + 人工锚点补充；
- **姓名池小**：name 特征权重被频率细化压低，卡号/联系方式主导分数——
  预期内，是数据现实不是缺陷；
- **单源现实**：B3 跨源召回在 EP 上恒 0，评测集以跨登记变体模拟多源形态，
  真多源接入后需重标定（写进报告口径）。
