# G2G 批次 6 · MPI 实战参数移植（规划，2026-10-05）

> 依据：覆盖矩阵 §G2G 批次 6「MPI 实战参数移植（阈值/规则配置 → mpi-service 调优）」；§四素材清单「empi 实战匹配阈值/规则配置 → mpi-service 参数调优素材」。参考物：nema `products/identity/empi`（empi-algo/empi-common 的 AlgoParam/AlgoConstants/AlgoDefaults/FixRuleType/FeatureType）。

## 勘察结论（两端参数面）

### nema empi（一代实战参数空间，AlgoParam）

- **双阈值**：linkTh 关联阈值 **0.9** / suspectTh 疑似阈值 **0.5**（AlgoConstants 默认值；三带语义：≥linkTh 自动关联、≥suspectTh 疑似复核、其余不同）。
- **特征权重**：10 特征（姓名/性别/电话/姓/名/出生年/出生日期/证件前缀·中段·后缀），默认全 1.0，加权进模型。
- **模型**：加权平均/决策树/随机森林(默认)/贝叶斯/神经网络/修正规则增强/自定义。
- **7 条修正规则**（FixRuleType，确定性线性规则，防 ML 误判的专家兜底）：
  1. SAME_XM_ZJHM 姓名+证件均同→1
  2. SAME_XM_LXFS 姓名+电话均同→1
  3. SAME_ZJHM_LXFS_CSRQ 证件+电话+出生日期均同→1
  4. DIFF_ZJHM_XM 证件+姓名均异→0
  5. DIFF_ZJHM_CSRQ 证件+生日均异→0
  6. TOO_HIGH 模型分=1 时按专家线性分下调（证件+生日→0.85、证件+姓名→0.9、证件+电话+姓名→0.98 等精调值）
  7. TOO_LOW 模型分=0 时对称上调
- **训练常量**：小样本 10000/大样本 100000/评估 10000/变异因子 10。

### data-os mpi-service（T5 混合引擎，已反超）

- **V2 评分**：Fellegi-Sunter m/u 逐比较级对数似然（card/name/gender/contact × AGREE/DISAGREE/MISSING），权重打包定版（T5b 重锚 2026-09-03）+ 测试重估锁定（漂移即红）。
- **三阈值**：tAuto 17.62（零错误 AUTO 约束）/ tReview -0.01 / tVeto -1.09（零误否约束）。
- **V1 规则带**：M-ep1/M-ep2（合取守卫 AUTO）、P-ep1/P-ep2（复核安全网）、P-fallback；T5=守卫先于分数 + 否决带。
- **调参纪律**：权重/阈值不是运行时配置——打包值 + 冻结语料测试锁定 + T5b 重标定流程（估计器/漂移报告/手册/基线）。

## 映射裁决

1. **不建运行时参数配置面**：nema 的 UI 可配 AlgoParam 不平移。data-os 的权重纪律是「冻结语料 + 测试锁定 + T5b 重标定」，运行时可配会破坏锁定红线（架构评审已裁决）。
2. **nema 模型不可移植，规则可移植**：nema 模型分数（RF/加权平均，[0,1] 相似度）与 data-os FS 对数似然分不同构，不做分数级移植；7 条修正规则是确定性线性规则，以 data-os 字段口径重写为**实战基线判定器**，作为 T5 决策的对拍（cross-check）素材——「调优素材」的落点即此。
3. **字段口径映射**：证件 ZJHM↔card、电话 LXFS↔contactHash（contactSame）、姓名 XM↔name。**出生日期不在 data-os 匹配面**（G3 三段身份键裁决无生日）：SAME_ZJHM_LXFS_CSRQ 退化为 证件+电话（口径注记）、DIFF_ZJHM_CSRQ 无对应字段不移植（记边界）。
4. **阈值带语义对照**：nema LINK(≥0.9)↔AUTO_MATCH、SUSPECT(≥0.5)↔REVIEW、其余↔NO_MATCH。对拍按带统计，不做分数级对齐。
5. **对拍覆盖口径（诚实边界）**：nema 规则可判定的对（规则命中）参与一致性统计；其余记 UNCOVERED（nema 模型带不可复现，不伪造）。
6. **分歧处置纪律**：对拍分歧不直接改权重——按 T5b 重标定纪律记为调优候选（backlog），是否重标定由用户裁决。

## 实施（单刀：实战基线对拍器 + 首轮报告）

1. **`NemaBaselineComparator`（test 侧，matcher 包）**：7 条规则的 data-os 重写（含退化口径），输出 `NemaDecision(ruleId, band[LINK/SUSPECT/DIFFERENT/UNCOVERED], triggered)`；参数常量带 nema 出处注释。
2. **`NemaBaselineReportTests`**：装载冻结标定集+评测集+人工锚点，T5 打包引擎逐对决策，与 nema 基线对拍——覆盖率/一致率/分歧矩阵（nemaBand×T5 三态）/分歧样本（掩码字段快照，前 20）；报告落 `eval/reports/nema-baseline-report.json`（入 Git 作 gate 证据，同 eval-report.json 先例）；断言锁格式与全量覆盖（不设一致率阈值，首轮如实）。
3. **文档**：参数对照表（本文件 §勘察）+ gate 文档记录首轮对拍结论与调优候选。

## 验收

- mpi-service 全量测试零回归 + 新测试绿；报告 JSON 入库。
- 无 UI 面（纯 eval 素材，gate 记录不适用浏览器核验的理由）。
