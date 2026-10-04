"""规则级得分计算（G2G 批次 3，nema ReportGenerator 公式平移）。

通用公式：``100 × (total − dirty) / total``（0 行 = 0 分，暴露问题口径）；
统计比较类（STAT_VAL_COMPARE/SQL_STAT_VAL/DETAIL_STAT）：通过 100，失败按
一致率 ``max(0, 100 × (1 − |check − ref| / |ref|))``（ref=0 时相等 100 否则 0）；
TIME_CONTINUITY 二元（通过 100 否则 0——M/N 窗口口径在批次 2 已裁剪）。

维度/总分/等级的聚合在控制面（拥有台账与维度归属），这里只产出规则级三值。
"""
from __future__ import annotations

from typing import Any

MAX_SCORE = 100.0
STAT_TYPES = {"STAT_VAL_COMPARE", "SQL_STAT_VAL", "DETAIL_STAT"}


def clamp(score: float | None) -> float | None:
    if score is None:
        return None
    return max(0.0, min(MAX_SCORE, score))


def rule_score(passed: bool, evidence: dict[str, Any],
               dirty: int | None, total: int | None,
               stat_pair: tuple[float, float] | None) -> tuple[float | None, dict[str, Any]]:
    """返回 (score, 计分痕迹)。score None 表示无法计分（执行 error / 无任何
    计数来源）——聚合端按 nema「无分不计入」口径跳过。"""
    rule_type = str(evidence.get("ruleType", "") or "").upper()
    if rule_type in STAT_TYPES:
        if passed:
            return MAX_SCORE, {"formula": "consistency", "basis": "passed"}
        if stat_pair is None:
            return None, {"formula": "consistency", "basis": "no-pair"}
        check_value, ref_value = stat_pair
        if ref_value == 0:
            score = MAX_SCORE if check_value == 0 else 0.0
        else:
            score = max(0.0, MAX_SCORE * (1 - abs(check_value - ref_value) / abs(ref_value)))
        return clamp(score), {
            "formula": "consistency", "checkValue": check_value, "refValue": ref_value,
        }
    if rule_type == "TIME_CONTINUITY":
        return (MAX_SCORE if passed else 0.0), {"formula": "binary"}
    # 通用行数公式：无 total（逻辑数据集/不可达）退化为二元；无 dirty（执行
    # error 无失败表）说明结论不由数据承载，返回 None 由消息侧解释。
    if passed:
        return MAX_SCORE, {"formula": "row-ratio", "basis": "passed"}
    if dirty is None:
        return None, {"formula": "row-ratio", "basis": "no-failure-table"}
    if total is None:
        return 0.0, {"formula": "row-ratio", "basis": "binary-fallback", "dirty": dirty}
    if total == 0:
        return 0.0, {"formula": "row-ratio", "basis": "empty-table"}
    score = MAX_SCORE * (total - dirty) / total
    return clamp(score), {"formula": "row-ratio", "dirty": dirty, "total": total}
