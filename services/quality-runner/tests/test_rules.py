from pathlib import Path

import pytest

from rules import RuleCatalog


def test_catalog_rejects_unregistered_selector(tmp_path: Path):
    path = tmp_path / "rules.yml"
    path.write_text(
        "rules:\n  - rule_id: r1\n    selector: r1\n    dataset_id: d1\n"
        "    evidence: {kind: not_null, column: c, columns: ['c']}\n",
        encoding="utf-8")
    catalog = RuleCatalog(str(path))
    assert catalog.get("r1").selector == "r1"
    assert catalog.get("missing") is None


def test_catalog_accepts_explicit_evidence_classification(tmp_path: Path):
    path = tmp_path / "rules.yml"
    path.write_text("""
rules:
  - rule_id: r1
    selector: r1
    dataset_id: d1
    evidence:
      kind: not_null
      column: patient_id
      columns:
        - {name: patient_id, classification: IDENTIFIER}
        - {name: status, classification: CATEGORY}
""", encoding="utf-8")
    rule = RuleCatalog(str(path)).get("r1")
    assert rule is not None
    assert rule.evidence["columns"][0]["classification"] == "IDENTIFIER"


def test_catalog_rejects_unknown_evidence_kind_at_load(tmp_path: Path):
    path = tmp_path / "rules.yml"
    path.write_text(
        "rules:\n  - rule_id: r1\n    selector: r1\n    dataset_id: d1\n"
        "    evidence: {kind: regex_match, column: c, columns: ['c']}\n",
        encoding="utf-8")
    with pytest.raises(ValueError, match="invalid evidence kind"):
        RuleCatalog(str(path))
