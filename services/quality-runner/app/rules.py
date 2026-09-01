from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from models import RuleDefinition


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_\.]*$")
_SELECTOR = re.compile(r"^[A-Za-z0-9_\.\-:\+]+$")
# dbt 通用测试族（失败表形状的声明），见 evidence.py。
_KINDS = {"not_null", "unique", "accepted_values", "relationships"}


class RuleCatalog:
    def __init__(self, path: str):
        self._rules: dict[str, RuleDefinition] = {}
        self.load(path)

    def load(self, path: str) -> None:
        document = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
        for raw in document.get("rules", []):
            rule_id = str(raw.get("rule_id", "")).strip()
            selector = str(raw.get("selector", "")).strip()
            dataset_id = str(raw.get("dataset_id", "")).strip()
            evidence = raw.get("evidence") or {}
            if not rule_id or not _SELECTOR.fullmatch(selector) or not dataset_id:
                raise ValueError(f"invalid quality rule registration: {rule_id}")
            kind = str(evidence.get("kind", "")).strip().lower()
            column = str(evidence.get("column", "")).strip()
            columns = evidence.get("columns", [])
            if kind not in _KINDS:
                raise ValueError(f"invalid evidence kind for {rule_id}")
            if not _IDENTIFIER.fullmatch(column):
                raise ValueError(f"invalid evidence column for {rule_id}")
            if not isinstance(columns, list) or not columns:
                raise ValueError(f"invalid evidence columns for {rule_id}")
            for item in columns:
                if isinstance(item, str):
                    if not _IDENTIFIER.fullmatch(item):
                        raise ValueError(f"invalid evidence column for {rule_id}")
                elif isinstance(item, dict):
                    name = str(item.get("name", ""))
                    classification = str(item.get("classification", "REDACTED")).upper()
                    if not _IDENTIFIER.fullmatch(name) or classification not in {
                        "IDENTIFIER", "CATEGORY", "SAFE", "REDACTED"
                    }:
                        raise ValueError(f"invalid evidence column policy for {rule_id}")
                else:
                    raise ValueError(f"invalid evidence column for {rule_id}")
            self._rules[rule_id] = RuleDefinition(rule_id, selector, dataset_id, dict(evidence))

    def get(self, rule_id: str) -> RuleDefinition | None:
        return self._rules.get(rule_id)

    def all(self) -> list[RuleDefinition]:
        return list(self._rules.values())
