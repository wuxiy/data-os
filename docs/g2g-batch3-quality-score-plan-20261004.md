# G2G 批次 3 · 质量评分模型平移（规划，2026-10-04）

> 依据：覆盖矩阵 §G2G 批次 3（2-3 天级）：nema 报告评分模型（N/M/W/C/D/S 公式 + 等级标准）平移到 data-os 治理驾驶舱。参考物：`dqp-master/.../ReportGenerator.java`（calcCheckItemScore/calcDimensionScore/calcTotalScore/calcGrade）、`ScoreStandard`/`QualityGrade`/`Dimension`（GB/T 36344-2018 六维）。

## nema 模型（勘察结论）

- **检查项分**：通用 `100 × (rowNum − dirtyNum) / rowNum`（0 行或执行失败 = 0 分，暴露问题口径）；统计比较类 `max(0, 100 × (1 − |检查值 − 参照值| / |参照值|))`（一致率）；时间连续性 M/N（窗口内有值天数/范围）。
- **维度分** = 维度内检查项分算术平均（无分项不计入）；**总分** = 维度分加权平均（ScoreStandard.weights；无权重等权）；**等级** = 按 grades.lowScore 降序首个达标；**通过线** passScore 逐检查项判 pass。
- 维度六枚举：完整性/一致性/规范性/准确性/时效性/稳定性。

## 映射裁决

1. **评分属主切分**：规则级得分在 **runner**（执行时它拥有失败表与目标表，能取 total/dirty 与统计值对）；维度/总分/等级聚合在 **控制面**（拥有台账与维度归属）。批次 2 的动态规则已带 rule_type → 维度归属；静态 registry 规则按 evidence kind 推断默认维度。
2. **规则分公式**（runner，按 evidence kind + 动态 ruleType）：
   - 行形状（not_null 族）：`100 × (total − failures) / total`，total = `COUNT(*)` 目标表（跨库全限定名经审计连接同 Doris 集群直查）；
   - 聚合形状（unique/accepted_values）：dirty = `SUM(n_records)`（重复值/非法值的实际行数）；
   - 统计类（STAT_VAL_COMPARE/SQL_STAT_VAL/DETAIL_STAT）：通过 = 100；失败读失败表唯一行的 (check_value, ref_value) 套一致率公式（ref=0 时：相等 100 否则 0）；
   - TIME_CONTINUITY：通过 = 100 否则 0（M/N 需窗口参数，批次 2 已裁剪为全历史断档——如实记边界）。
3. **单一生效评分标准**（不做 nema 多标准 CRUD）：V25 `quality_score_standard` 单行（pass_score/weights_json/grades_json），GET/PUT API + 门户治理面编辑；默认权重等权、等级示例（优质 90/良好 80/合格 60/待改进 0）。
4. **落库与聚合**：V25 给 `quality_rule_runs` 增 score/total_rows/dirty_rows；runner 运行载荷带上三值，控制面状态同步回写；`GET /api/v1/quality/score` 聚合每规则最近终态运行 → 维度分 → 加权总分 → 等级 → 逐规则 pass。
5. **呈现**：治理驾驶舱加「质量评分」区块（六维条 + 总分/等级徽标 + 逐规则明细 + 标准编辑抽屉）。

## 验收

- runner：评分分支单测（行/聚合/统计一致率/边界）+ 载荷字段；`pytest tests/` 全绿。
- control-plane：标准 CRUD、评分聚合（种运行数据对拍公式）、维度推断、既有零回归；`mvn test` 全绿。
- portal：qa 链 + 浏览器核验评分区块与标准编辑。

## 边界预告

- TIME_CONTINUITY 二元得分（无 M/N）；总分只聚合「有终态运行」的规则（无运行不进入维度均值，与 nema「无分不计入」同口径）；外部 finding 运行不带分（score NULL 不计入）。
