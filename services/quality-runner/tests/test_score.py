"""G2G 批次 3：规则级评分公式测试（nema ReportGenerator 公式平移）。"""
from __future__ import annotations

import pytest

from score import rule_score


def test_generic_row_ratio_formula():
    # 100 × (total − dirty) / total
    score, basis = rule_score(False, {}, 25, 100, None)
    assert score == pytest.approx(75.0)
    assert basis["formula"] == "row-ratio"
    # 空表 / 无 dirty（执行 error）→ 0 分 / 无法计分
    assert rule_score(False, {}, 0, 0, None)[0] == 0.0
    assert rule_score(False, {}, None, 100, None)[0] is None
    # 无 total（逻辑数据集）退化为二元
    assert rule_score(False, {}, 3, None, None)[0] == 0.0
    # 通过一律满分
    assert rule_score(True, {}, None, None, None)[0] == 100.0
    # 上限截断（dirty 为负不可能，但公式防御性钳制）
    assert rule_score(False, {}, 0, 100, None)[0] == 100.0


def test_statistical_consistency_formula():
    evidence = {"ruleType": "STAT_VAL_COMPARE"}
    # 通过 = 100（无查询）
    assert rule_score(True, evidence, None, None, None)[0] == 100.0
    # 一致率：|100-95|/95 → 94.736…
    score, basis = rule_score(False, evidence, None, None, (95.0, 100.0))
    assert score == pytest.approx(95.0)
    assert basis["checkValue"] == 95.0 and basis["refValue"] == 100.0
    # 反向偏离同公式（105 vs 100 → 95）
    assert rule_score(False, evidence, None, None, (105.0, 100.0))[0] == pytest.approx(95.0)
    # ref=0：相等 100 否则 0；大偏差钳到 0
    assert rule_score(False, evidence, None, None, (0.0, 0.0))[0] == 100.0
    assert rule_score(False, evidence, None, None, (5.0, 0.0))[0] == 0.0
    assert rule_score(False, evidence, None, None, (1000.0, 10.0))[0] == 0.0
    # 失败但无值对（失败表缺行）→ 无法计分
    assert rule_score(False, evidence, None, None, None)[0] is None


def test_binary_types():
    continuity = {"ruleType": "TIME_CONTINUITY"}
    assert rule_score(True, continuity, None, None, None)[0] == 100.0
    assert rule_score(False, continuity, 7, 300, None)[0] == 0.0


def test_aggregate_dirty_counts_flow_through_engine_shapes():
    # 聚合形状（unique/accepted_values）的 dirty 由 SUM(n_records) 提供，
    # 公式层只消费 dirty/total——此处锁定消费口径
    score, _ = rule_score(False, {"kind": "unique"}, 40, 200, None)
    assert score == pytest.approx(80.0)
