from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class RuleDefinition:
    rule_id: str
    selector: str
    dataset_id: str
    evidence: dict[str, Any]


@dataclass(frozen=True)
class QualityRun:
    run_id: str
    issue_id: str
    tenant_id: str
    institution_id: str
    rule_id: str
    dataset_id: str
    execution_batch_id: str
    idempotency_key: str
    status: str
    passed: bool | None
    message: str
    sample_evidence: list[dict[str, Any]]
    artifact_uri: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    execution_generation: int = 0
