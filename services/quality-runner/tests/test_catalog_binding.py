"""仓库契约：rules.yml 注册的 selector 必须在 quality/dbt 工程中以
同名测试存在——selector 是规则注册表与 dbt 执行的唯一粘合点，两端漂移
会让复检静默落空。"""

from pathlib import Path
from typing import Any

import yaml

from rules import RuleCatalog

REPO_ROOT = Path(__file__).resolve().parents[3]
RULES_FILE = REPO_ROOT / "services" / "quality-runner" / "rules.yml"
DBT_MODEL_DIR = REPO_ROOT / "quality" / "dbt" / "models"

EP_EDGE_SELECTORS = {
    "quality_ep_edge_cfzb_id_not_null",
    "quality_ep_edge_cfzb_id_unique",
    "quality_ep_edge_cfzb_cfptzt_values",
    "quality_ep_edge_ypcfmx_cfzid_fk",
}


def _collect_test_names(node: Any, found: set[str]) -> None:
    if isinstance(node, dict):
        tests = node.get("data_tests")
        if isinstance(tests, list):
            for test in tests:
                if isinstance(test, dict):
                    for config in test.values():
                        if isinstance(config, dict) and config.get("name"):
                            found.add(str(config["name"]))
        for value in node.values():
            _collect_test_names(value, found)
    elif isinstance(node, list):
        for item in node:
            _collect_test_names(item, found)


def _dbt_test_names() -> set[str]:
    found: set[str] = set()
    for path in sorted(DBT_MODEL_DIR.glob("*.yml")):
        document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        _collect_test_names(document, found)
    return found


def test_every_registered_selector_exists_in_dbt_project():
    catalog = RuleCatalog(str(RULES_FILE))
    missing = [rule.rule_id for rule in catalog.all() if rule.selector not in _dbt_test_names()]
    assert not missing, f"rules.yml 的 selector 未在 quality/dbt 命名测试：{missing}"


def test_ep_edge_rule_pack_registered():
    catalog = RuleCatalog(str(RULES_FILE))
    registered = {rule.selector for rule in catalog.all()}
    assert EP_EDGE_SELECTORS <= registered
    for rule in catalog.all():
        if rule.selector in EP_EDGE_SELECTORS:
            assert rule.evidence["table"].startswith("ods_ep.")
            assert rule.dataset_id == "asset-ep-prescription-edge"
