# Gate · G2G 批次 6：MPI 实战参数移植（nema empi 基线对拍）

- 日期：2026-10-05
- 依据：[g2g-batch6-mpi-baseline-plan-20261005.md](../g2g-batch6-mpi-baseline-plan-20261005.md)；参考物 nema `products/identity/empi`（AlgoParam/FixRuleType/AlgoConstants）
- 结果：**通过**（mpi-service 全量 58/58 零跳过红 + 新对拍测试绿；首轮对拍报告入库；无 UI 面故无浏览器核验——对拍器为 eval 素材，gate 如实记录）

## 交付范围

### 映射裁决落地

- **不建运行时参数配置面**：nema 的 UI 可配 AlgoParam 不平移——data-os 权重纪律是「冻结语料 + 测试锁定 + T5b 重标定」，运行时可配会破坏锁定红线。
- **模型不可移植、规则可移植**：nema 模型分数（RF/加权平均 [0,1] 相似度）与 data-os FS 对数似然不同构；7 条修正规则中的确定性线性规则以 data-os 字段口径重写为**实战基线判定器**，定位=T5 决策的对拍素材（「调优素材」的落点）。
- **口径退化如实记录**：出生日期不在 data-os 匹配面（G3 三段身份键裁决）——SAME_ZJHM_LXFS_CSRQ 退化「证件+电话」、DIFF_ZJHM_CSRQ 不移植；TOO_HIGH/TOO_LOW 依赖模型分数形态，不移植；nema 模型带不可复现 → UNCOVERED 不参与一致性统计（覆盖 2622/10084=26%）。

### 组件

- **`NemaBaselineComparator`（test 侧）**：4 条可移植规则（SAME_XM_ZJHM / SAME_XM_LXFS / SAME_ZJHM_LXFS 退化 / DIFF_ZJHM_XM）+ 双阈值带（LINK≥0.9↔AUTO、SUSPECT≥0.5↔REVIEW、其余↔NO_MATCH）；参数常量带 nema 出处。
- **`NemaBaselineReportTests`**：冻结标定集+评测集+人工锚点全量对拍 T5（打包权重 + tVeto），产出覆盖率/带一致率/分歧矩阵/nema 规则×T5 规则带分解/分歧样本（掩码快照 20 条）/调优候选自动标注；报告落 `eval/reports/nema-baseline-report.json` 入 Git；断言锁全量覆盖与矩阵完备（不设一致率阈值，首轮如实）。

## 首轮对拍结论（调优素材核心）

- **总量 10084 对，规则覆盖 2622（26%），带一致率 41.4%**。
- **红线格全零**：DIFFERENT→AUTO_MATCH = 0（nema 判不同而 T5 自动合并：零例）；LINK→NO_MATCH = 0（tVeto 未误伤规则可判定对）。
- **分歧集中在 LINK→REVIEW 1536，全部落在 data-os 有意收紧的守卫带**（规则分解实证）：
  - `SAME_XM_LXFS→P-ep2` 953：nema「姓名+电话同→自动关联」；T5 走 B6 复核（缺证件合取不下 AUTO）。
  - `SAME_XM_LXFS→P-fallback` 480：同类策略差异（无守卫命中兜底复核）。
  - `SAME_XM_ZJHM→P-ep1` 103：**同证件+同名但性别冲突**——nema 忽略性别判关联；T5 卡复用安全网强制复核（宁可复核不可错并）。
- **一致面**：`SAME_XM_ZJHM→M-ep2` 620 + `SAME_XM_LXFS→M-ep1` 353（证件/主键合取双方一致 AUTO）；`DIFF_ZJHM_XM→NO_MATCH` 113（一致拒判，其中 94 经否决带）。
- **结论**：两代策略差异被量化——data-os 的保守带（证件合取守卫 + 卡复用安全网）是 G14/G15 架构裁决的有意结果，非缺陷；**不建议**按 nema 基线放宽（放宽 P-ep1/P-ep2 即回到「姓名+电话自动并档」一代策略，与医疗 MPI 的错并代价约束冲突）。无重标定动作（权重调整按 T5b 纪律须用户裁决，本轮无触发证据）。

## 测试证据

- `NemaBaselineReportTests` 1/1 绿（矩阵行和=覆盖数、覆盖非空、三分带全在、样本封顶）；报告 JSON 与测试同步再生成。
- mpi-service 全量 `mvn test` 58/58（1 既有跳过不变）零回归。

## 边界（记 backlog）

1. 对拍器为 test 侧 eval 素材，不进运行时（无 API/UI 面；报告随测试再生成）。
2. nema 生产环境的实际改参（若曾偏离默认 0.9/0.5）无从取证——基线取 AlgoConstants 默认值（README/SQL 未见覆盖值）。
3. 出生日期类规则（2 条）因字段缺失不可移植；若未来匹配面引入生日，可补。
4. 分歧样本仅存 20 条掩码快照（完整分歧可由测试本地复跑展开）。
