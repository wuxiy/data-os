"""评估域模型（Pydantic）：Requirement 装载态与评估报告。

报告 JSON 直接作为 control-plane `ai_data_product_version.readiness_json`
的载荷（G9-6 回写契约）。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Status = Literal["PASS", "WARN", "FAIL", "NOT_APPLICABLE"]
Dimension = Literal["clean", "contextual", "consumable", "current", "correlated", "compliant"]

DIMENSIONS: list[Dimension] = ["clean", "contextual", "consumable", "current", "correlated", "compliant"]

DIMENSION_LABELS: dict[str, str] = {
    "clean": "Clean",
    "contextual": "Contextual",
    "consumable": "Consumable",
    "current": "Current",
    "correlated": "Correlated",
    "compliant": "Compliant",
}


class RequirementDef(BaseModel):
    """requirement.yaml 的装载态（check 声明保持原始字典）。"""

    id: str
    title: str
    dimension: Dimension
    severity: Literal["critical", "major", "minor"]
    applicable_profiles: list[str]
    diagnostic: str
    check: dict[str, Any]
    dir_path: str = ""


class ProfileDef(BaseModel):
    """profile yaml 的装载态。"""

    id: str
    name: str
    requirements: dict[str, float]
    thresholds: dict[str, float]


CAMEL = ConfigDict(populate_by_name=True)


class RequirementResult(BaseModel):
    model_config = CAMEL
    id: str
    title: str
    dimension: Dimension
    severity: str
    status: Status
    metric: float | None = None
    metric_name: str | None = Field(default=None, alias="metricName")
    thresholds: dict[str, Any] = Field(default_factory=dict)
    diagnostic: str = ""
    note: str = ""


class GateResult(BaseModel):
    model_config = CAMEL
    overall: float
    result: Literal["PASS", "REVIEW", "FAIL"]
    certification: Literal["CANDIDATE", "REVIEW_REQUIRED", "FAIL", "BLOCKED"]
    critical_failures: list[str] = Field(default_factory=list, alias="criticalFailures")


class AssessmentReport(BaseModel):
    model_config = CAMEL
    product: str
    version: str
    profile: str
    assessed_at: str = Field(alias="assessedAt")
    engine_version: str = Field(default="0.1.0", alias="engineVersion")
    requirements: list[RequirementResult]
    dimensions: dict[str, float]
    overall: float
    gate: GateResult
    problems: dict[str, list[str]] = Field(default_factory=dict)
