# Gate · G2G 批次 2 第二刀：质量规则动态化（跨表/统计/时间宏 + 值域字典引用）

- 日期：2026-10-04
- 依据：[g2g-batch2-quality-rules-plan-20261004.md](../g2g-batch2-quality-rules-plan-20261004.md) 第二刀预告 + 首刀 gate 边界①
- 结果：**通过**（runner 48/48、control-plane 全量零回归 + 契约测试 8/8、前端链全绿、浏览器核验通过）——**nema 16 类规则语义全数移植完毕，批次 2 收官**

## 交付范围

### 7 类新规则（nema RuleType 对应与编译语义）

| data-os 类型 | nema 编号 | 参数 | 失败表形状 |
| --- | --- | --- | --- |
| CROSS_VAL_COMPARE | 202 跨表数据值比较 | refDataset/refColumn + 关联键对 | 整行（t. 前缀白名单投影） |
| STAT_VAL_COMPARE | 203 统计数据值比较 | op/refOp（COUNT/SUM/AVG/MAX/MIN）+ refDataset/refColumn | (check_value, ref_value) 派生 |
| SQL_STAT_VAL | 204 SQL 统计值比较 | checkSql/refSql（各单统计值，只读校验） | (check_value, ref_value) 派生 |
| DETAIL_STAT | 205 明细汇总校验 | refOp + refDataset/refColumn + 关联键对 | (关联键…, check_value, ref_value) 派生 |
| FIELD_LOGIC | 401 字段间关系 | logic 表达式（禁分号/注释片段） | 整行白名单 |
| UPDATE_TIME | 501 更新率 | ingestColumn + threshold/timeUnit（折算秒，TIMESTAMPDIFF） | 整行白名单 |
| TIME_CONTINUITY | 601 时间连续性 | （无参数） | (prev_period, cur_period) 派生 |

- **VAL_SET 字典引用**（nema ValSetRule 的 Dict 分支）：`standardElementId` 在控制面保存时解析为标准中心值域代码**快照**（`StandardRepository.findElementCodes`，租户校验）内联进 values；解析属主在控制面，runner 保持无标准中心依赖。标准值域变更不自动跟随——重存规则刷新（快照语义已在表单提示）。
- 统计比较类的 NULL 语义：任一侧统计值为 NULL（空表）即失败行（无法验证一致性，如实呈现）。
- DIMENSION 归属补全：一致性四类、准确性 FIELD_LOGIC、及时性 UPDATE_TIME、稳定性 TIME_CONTINUITY。

### 有意适配（记档）

1. **TIME_CONTINUITY 语义适配**：nema「检查窗口内有值天数/范围」适配为「全历史相邻期间断档检测」（LAG + TIMESTAMPDIFF(DAY) > 1）；未实现检查窗口参数。
2. **CROSS_VAL_COMPARE/DETAIL_STAT 的 JOIN 语义**：假定参照侧关联键唯一（nema exists 语义在重复参照键时会放大失败行）；DETATL_STAT 参照键按 GROUP BY 聚合，无此问题。
3. 统计函数 COUNT 不需要值列（COUNT(*)）。

### 组件

- runner `rulegen.py`：7 类编译分支 + 计算形状证据派生（COMPUTED_EVIDENCE_TYPES 服务端覆写白名单，全 SAFE）+ 校验（关联键等长、统计算子枚举、双 SQL 只读、逻辑表达式守卫、时效参数）；COLUMN_OPTIONAL_TYPES 扩 SQL_STAT_VAL。
- control-plane：SUPPORTED_TYPES 15 类、types 目录扩 7 项（computedEvidence 标志）、`StandardRepository.findElementCodes` + 保存时字典解析（失败拒绝不落账）。
- portal：类型目录 15 项、表单按类型分支渲染（关联键对/统计函数双下拉/双 SQL/逻辑表达式/时效三件套/连续性提示）、计算形状类型隐藏证据白名单编辑器并给派生说明。

## 测试证据

- runner `test_rulegen.py` +3 项（累计 11）：7 类 SQL 快照（含 TIMESTAMPDIFF 折算/LAG 窗口/GROUP BY 参照键对齐）、派生证据（STAT 双值列/DETAIL 含关联键）、7 类误用负向（键数量不一致/非法算子/缺 refSql/写语句/逻辑表达式分号/负阈值/非法单位/行形状仍需白名单）。全量 48/48。
- control-plane `QualityRuleAdminApiTest` 扩至 8 项：15 类目录、DETAIL_STAT 保存推送（空白名单透传）、VAL_SET 标准快照解析（内联种标准→保存→values 落库随推送/引用不存在 400 不落账）。全量 `mvn test` 零回归。
- 前端链全绿；浏览器核验：STAT_VAL_COMPARE（计算形状：派生提示 + 白名单编辑器隐藏 + 保存成行）、UPDATE_TIME（业务时间列提示 + 白名单可见 + 保存成行）、视觉合格。

## 边界（记 backlog）

1. 16 类语义全数到位；宏类生成的 SQL 为 Doris 方言（REGEXP/TIMESTAMPDIFF/LAG 窗口函数），跨方言不可移植（质量目标域本就限 Doris）。
2. TIME_CONTINUITY 无检查窗口参数（全历史断档）；nema 的 M/N 评分口径属批次 3 评分模型输入。
3. VAL_SET 快照语义：标准值域变更需重存规则刷新（无自动跟随/无漂移告警）。
4. 首刀遗留不变：推送事务内孤儿收敛、dev Keycloak quality:admin scope、白名单列无预检。
