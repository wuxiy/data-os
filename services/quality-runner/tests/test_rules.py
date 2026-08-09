from pathlib import Path

from rules import RuleCatalog


def test_catalog_rejects_unregistered_selector(tmp_path: Path):
    path = tmp_path / "rules.yml"
    path.write_text("rules:\n  - rule_id: r1\n    selector: r1\n    dataset_id: d1\n    evidence: {}\n", encoding="utf-8")
    catalog = RuleCatalog(str(path))
    assert catalog.get("r1").selector == "r1"
    assert catalog.get("missing") is None
