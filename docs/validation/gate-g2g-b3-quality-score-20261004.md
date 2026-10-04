# Gate · G2G 批次 3：质量评分模型平移（N/M/W/C/D/S 公式 + 等级标准）

- 日期：2026-10-04
- 依据：[g2g-batch3-quality-score-plan-20261004.md](../g2g-batch3-quality-score-plan-20261004.md)；参考物 nema `ReportGenerator`/`ScoreStandard`/`QualityGrade`/`Dimension`（GB/T 36344 六维）
- 结果：**通过**（runner 52/52、control-plane 全量零回归 + 评分契约 3/3、前端链全绿、浏览器核验公式对拍通过）——**批次 3 收官**

## 交付范围

### 公式平移（nema → data-os）

| 层 | nema 公式 | data-os 落点 |
| --- | --- | --- |
| 规则级 | `100×(行数−脏数)/行数`（0 行/失败=0 分） | runner `score.py`（行形状：total=目标表 COUNT、dirty=失败表 COUNT；聚合形状 dirty=SUM(n_records)） |
| 规则级 | 一致率 `max(0, 100×(1−\|check−ref\|/\|ref\|))` | 统计三类（STAT/SQL_STAT/DETAIL）：通过 100，失败读失败表唯一值对套公式（ref=0 相等 100 否则 0） |
| 规则级 | M/N（有值天数/范围） | TIME_CONTINUITY 二元（100/0）——窗口口径批次 2 已裁剪，如实记边界 |
| 维度 | 维度内规则分算术平均（无分不计入） | 控制面 `QualityScoreService`（每规则最近终态运行） |
| 总分 | 维度加权平均（无权重等权） | 同上，权重取自生效标准 |
| 等级 | grades.lowScore 降序首个达标 | 同上 |
| 通过线 | passScore 逐规则 | 同上（rules[].passed） |

### 组件

- **runner**：`score.py`（公式单一属主）、`EvidenceReader` 增 `dirty_row_count`（聚合形状 SUM(n_records)/行形状 COUNT）、`total_row_count`（目标库.表跨库直查）、`stat_pair`（统计值对）；DbtEngine 执行后附加评分（通过即 100 零查询；计数异常不掩盖执行结论→score=None）；`quality_runner_runs` 增 score/total_rows/dirty_rows 并随 GET /runs 载荷返回；动态规则 registry evidence 增 `ruleType` 键供公式分支。
- **control-plane**：V25（runs 三列 + `quality_score_standard` 单行默认标准：六维等权 + 优质 90/良好 80/合格 60/待改进 0）；执行器状态链（QualityRuleExecutionStatus/QualityResultPayload/QualityRunStore/Repository）全链透传三值（COALESCE 保留旧值）；`QualityScoreService` 聚合（维度归属：动态台账 rule_type 目录优先、静态 registry evidence kind 推断、registry 表缺失容错降级）+ `GET /api/v1/quality/score`、`GET/PUT /api/v1/quality/score/standard`。
- **portal**：治理驾驶舱挂 `QualityScorePanel`——总分/等级徽标 + 六维进度条（无运行维度如实「无运行」）+ 逐规则明细（通过线）+ 评分标准编辑抽屉（通过线/六维权重/等级行编辑，保存即重算）。

## 测试证据

- runner `test_score.py`（4 项）：通用公式（含 0 行/无表/无 total 退化/通过满分）、一致率（正反向偏离/ref=0 分支/钳 0/无值对 None）、二元、聚合 dirty 口径。全量 52/52。
- control-plane `QualityScoreApiTest`（3 项）：聚合对拍（完整性 100+80→90、时效性 60→等权 75→权重×3→67.5 手算精确一致；等级判定）、标准 CRUD（默认形状/非法权重与缺 lowScore 400/passScore 单独更新保持其余）、通过线随标准翻转（60→通过、95→未通过）。既有 fake 签名机械跟随（QualityOutcomeServiceTest）。全量 `mvn test` 零回归。
- 前端链全绿；浏览器核验（mock 评分面）：总分 78.9 与手算一致（规范性权重 2）、六维条与无运行态、4 规则明细；标准编辑（时效性权重 1→4）保存后总分重算 64.4 与手算一致；视觉合格。

## 边界（记 backlog）

1. **评分只覆盖终态运行**：无终态运行/外部 finding（score NULL）不进入维度均值（nema「无分不计入」同口径）；总分 NULL 时等级为空。
2. TIME_CONTINUITY 二元得分（M/N 需窗口参数）；未来若恢复窗口口径需 runner 在执行时计算。
3. total_rows 经审计连接对业务库跨库 COUNT——超大表每次失败运行都伴随一次全表 COUNT（成本记档，可后续缓存/限流）。
4. dev 真实链路：runner 评分需部署侧同步（dev Keycloak quality:admin scope 欠账仍是批次 2 遗留）。
5. 工程坑两条：H2 不接受 `SELECT DISTINCT` 与窗口函数组合（改 ROW_NUMBER 子查询）；测试种子 run id 超 VARCHAR(36)。
