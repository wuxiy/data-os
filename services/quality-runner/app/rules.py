from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

from models import RuleDefinition


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_\.]*$")
_SELECTOR = re.compile(r"^[A-Za-z0-9_\.\-:\+]+$")


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
            table = str(evidence.get("table", "")).strip()
            columns = evidence.get("columns", [])
            if table and not _IDENTIFIER.fullmatch(table):
                raise ValueError(f"invalid evidence table for {rule_id}")
            if not isinstance(columns, list) or any(not _IDENTIFIER.fullmatch(str(item)) for item in columns):
                raise ValueError(f"invalid evidence columns for {rule_id}")
            self._rules[rule_id] = RuleDefinition(rule_id, selector, dataset_id, dict(evidence))

    def get(self, rule_id: str) -> RuleDefinition | None:
        return self._rules.get(rule_id)

    def all(self) -> list[RuleDefinition]:
        return list(self._rules.values())
