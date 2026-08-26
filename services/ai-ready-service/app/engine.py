"""评估引擎：探针调度 → 四态判定 → 6C 聚合 → Certification Gate。

纯函数化（catalog + adapters 注入），保证幂等可对拍：同输入同输出。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from catalog import Catalog
from models import (
    DIMENSIONS,
    DIMENSION_LABELS,
    AssessmentReport,
    GateResult,
    RequirementDef,
    RequirementResult,
)

STATUS_SCORES = {"PASS": 1.0, "WARN": 0.5, "FAIL": 0.0}


class Engine:
    def __init__(self, catalog: Catalog, doris: Any, om: Any):
        self._catalog = catalog
        self._doris = doris
        self._om = om

    def assess(self, product: str, version: str, profile_id: str) -> AssessmentReport:
        requirement_ids = self._catalog.requirement_ids(profile_id)
        profile = self._catalog.profiles[profile_id]
        thresholds = self._catalog.gate_thresholds(profile_id)

        results = [self._run(self._catalog.requirements[rid]) for rid in requirement_ids]

        # N/A 剔除后聚合：维度分 = 维内 weight 加权平均；Overall = 有值维度等权平均
        dimensions: dict[str, float] = {}
        for dimension in DIMENSIONS:
            members = [(result, profile.requirements[result.id])
                       for result in results
                       if result.dimension == dimension and result.status != "NOT_APPLICABLE"]
            if not members:
                continue
            weight_sum = sum(weight for _, weight in members)
            dimensions[dimension] = round(
                sum(STATUS_SCORES[result.status] * weight for result, weight in members) / weight_sum, 4)
        overall = round(sum(dimensions.values()) / len(dimensions), 4) if dimensions else 0.0

        critical_failures = [result.id for result in results
                             if result.status == "FAIL" and result.severity == "critical"]
        veto = bool(self._catalog.policy.get("critical_veto", {}).get("enabled", True))

        if overall < thresholds["fail_below"]:
            gate_result, certification = "FAIL", "FAIL"
        elif overall < thresholds["review_below"]:
            gate_result, certification = "REVIEW", "REVIEW_REQUIRED"
        else:
            gate_result, certification = "PASS", "CANDIDATE"
        if veto and critical_failures:
            certification = "BLOCKED"

        problems: dict[str, list[str]] = {}
        for status in ("FAIL", "WARN"):
            problems[status] = [result.id for result in results if result.status == status]

        return AssessmentReport(
            product=product,
            version=version,
            profile=profile_id,
            assessed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            requirements=results,
            dimensions=dimensions,
            overall=overall,
            gate=GateResult(overall=overall, result=gate_result,
                            certification=certification, critical_failures=critical_failures),
            problems=problems,
        )

    # ---- 单项执行 ----

    def _run(self, requirement: RequirementDef) -> RequirementResult:
        check = requirement.check
        base = dict(id=requirement.id, title=requirement.title, dimension=requirement.dimension,
                    severity=requirement.severity, diagnostic=requirement.diagnostic,
                    thresholds={"pass": check.get("pass"), "warn": check.get("warn"),
                                "direction": check.get("direction")})
        try:
            if check.get("type") == "doris_metric":
                if check.get("requires_table") and not self._table_exists(check["requires_table"]):
                    return RequirementResult(**base, status="NOT_APPLICABLE",
                                             note=check.get("not_applicable_reason", ""))
                metric = self._doris_metric(requirement, check)
            elif check.get("type") == "om_probe":
                metric = self._om_probe(check)
            else:
                raise RuntimeError(f"未知 check 类型：{check.get('type')}")
        except Exception as exc:  # 探针失败按 FAIL 收口（诊断信息保留），不让单点炸整场
            return RequirementResult(**base, status="FAIL", note=f"探针执行失败：{exc}")
        status = self._verdict(metric, float(check["pass"]), float(check["warn"]),
                               check["direction"])
        return RequirementResult(**base, status=status, metric=metric,
                                 metric_name=check.get("metric") or check.get("probe"))

    def _doris_metric(self, requirement: RequirementDef, check: dict) -> float:
        sql_path = f"{requirement.dir_path}/{check['sql_file']}"
        with open(sql_path, encoding="utf-8") as fh:
            sql = fh.read()
        return float(self._doris.metric(sql))

    def _om_probe(self, check: dict) -> float:
        probe = check.get("probe")
        handler = getattr(self._om, str(probe), None)
        if handler is None:
            raise RuntimeError(f"未知 OM 探针：{probe}")
        return float(handler(check))

    def _table_exists(self, qualified: str) -> bool:
        database, _, table = qualified.partition(".")
        return self._doris.table_exists(database, table)

    @staticmethod
    def _verdict(metric: float, pass_at: float, warn_at: float, direction: str) -> str:
        if direction == "higher_better":
            if metric >= pass_at:
                return "PASS"
            return "WARN" if metric >= warn_at else "FAIL"
        if metric <= pass_at:
            return "PASS"
        return "WARN" if metric <= warn_at else "FAIL"


def render_cli(report: AssessmentReport) -> str:
    """架构文档 §34 的 CLI 输出样式。"""
    lines = [
        "AI Ready Assessment",
        "",
        f"Product:\n{report.product}",
        "",
        f"Version:\n{report.version}",
        "",
        f"Profile:\n{report.profile}",
        "",
    ]
    for dimension in DIMENSIONS:
        if dimension in report.dimensions:
            lines.append(f"{DIMENSION_LABELS[dimension]:<14}{report.dimensions[dimension]:.2f}")
    lines += ["", f"{'Overall':<14}{report.overall:.2f}", "",
              f"Result:\n{report.gate.certification}", ""]
    if report.problems.get("FAIL"):
        lines.append("FAILED")
        lines += [f"- {item}" for item in report.problems["FAIL"]]
    if report.problems.get("WARN"):
        lines.append("WARN")
        lines += [f"- {item}" for item in report.problems["WARN"]]
    lines.append("")
    return "\n".join(lines)
