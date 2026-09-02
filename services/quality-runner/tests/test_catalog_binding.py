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

# G16b EP 域首批 9 表规则包：dataset_id 用「库.表」形态（控制面按 fqn 段
# 直接匹配）。孤儿 EP_ID 的三条 FK（status/chain/flow→主表）刻意不在册。
EP_DOMAIN_RULES = {
    "quality_ep_status_id_not_null": "ods_ep.ep_status",
    "quality_ep_status_id_unique": "ods_ep.ep_status",
    "quality_ep_chain_id_not_null": "ods_ep.ep_chain",
    "quality_ep_chain_id_unique": "ods_ep.ep_chain",
    "quality_ep_chain_epflowid_fk": "ods_ep.ep_chain",
    "quality_ep_yb_rx_hirxno_not_null": "ods_ep.ep_yb_rx",
    "quality_ep_yb_rx_hirxno_unique": "ods_ep.ep_yb_rx",
    "quality_ep_tag_id_not_null": "ods_ep.ep_tag",
    "quality_ep_tag_id_unique": "ods_ep.ep_tag",
    "quality_ep_tag_epid_fk": "ods_ep.ep_tag",
    "quality_ep_flow_id_not_null": "ods_ep.ep_flow",
    "quality_ep_flow_id_unique": "ods_ep.ep_flow",
    "quality_ep_drug_ext_id_not_null": "ods_ep.ep_drug_ext",
    "quality_ep_drug_ext_id_unique": "ods_ep.ep_drug_ext",
    "quality_ep_drug_ext_epid_fk": "ods_ep.ep_drug_ext",
    "quality_patient_id_not_null": "ods_ep.patient",
    "quality_patient_id_unique": "ods_ep.patient",
    "quality_patient_del_values": "ods_ep.patient",
    "quality_patient_card_id_not_null": "ods_ep.patient_card",
    "quality_patient_card_id_unique": "ods_ep.patient_card",
    "quality_patient_card_patientid_fk": "ods_ep.patient_card",
    "quality_patient_ep_record_id_not_null": "ods_ep.patient_ep_record",
    "quality_patient_ep_record_id_unique": "ods_ep.patient_ep_record",
    "quality_patient_ep_record_patientid_fk": "ods_ep.patient_ep_record",
    "quality_patient_ep_record_epid_fk": "ods_ep.patient_ep_record",
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
            assert rule.evidence["kind"] in {"not_null", "unique", "accepted_values", "relationships"}
            assert rule.evidence["column"]
            assert rule.dataset_id == "asset-ep-prescription-edge"


def test_ep_domain_rule_pack_registered():
    catalog = RuleCatalog(str(RULES_FILE))
    by_selector = {rule.selector: rule for rule in catalog.all()}
    for selector, dataset_id in EP_DOMAIN_RULES.items():
        rule = by_selector.get(selector)
        assert rule is not None, f"G16b 规则缺失：{selector}"
        assert rule.dataset_id == dataset_id
        assert rule.evidence["kind"] in {"not_null", "unique", "accepted_values", "relationships"}
        assert rule.evidence["column"]
        # 患者域证据列白名单不得包含身份值列（姓名/证件/卡号/电话）
        if dataset_id in {"ods_ep.patient", "ods_ep.patient_card", "ods_ep.patient_ep_record"}:
            phi_columns = {"NAME", "PHONE", "CARD_NUMBER", "PATIENT_NAME", "PATIENT_IDENTITY"}
            listed = {str(col.get("name", "")).upper() for col in rule.evidence.get("columns", [])}
            assert not (listed & phi_columns), f"{selector} 证据列含 PHI：{listed & phi_columns}"
