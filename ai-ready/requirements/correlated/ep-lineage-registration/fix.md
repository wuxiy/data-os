# 修复指引：ep_lineage_registration

## 缺口

`ods_ep.ep_mz_cfzb` 在 OpenMetadata 无下游血缘边（或少于期望 2 条）。

## 修复路径

1. 现有 2 条边来自 OM Superset 连接器自动捕获的分析模型列级血缘（G4/G16e 消费面）；
2. 边缺失时：核对 Superset 摄取作业（om-ingest-superset.sh）是否覆盖基于该表的图表，
   或经声明式血缘登记（G7 addLineage）补边；
3. 期望边数变化（新增消费面）时同步本 requirement 的 expected_edges。

## 阈值依据

- pass 1.0（实边/期望 ≥ 2/2）：主表到消费面的追溯链完整；
- warn 0.5：至少 1 条边在册（部分追溯）。

## 变更记录

- 2026-09-15（G17/AI-1）：新立。dev 实测 2/2（Superset 列级血缘）。
