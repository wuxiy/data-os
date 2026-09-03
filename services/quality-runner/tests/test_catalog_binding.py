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

# G16c 二批规则包：ORDER 交易域（源表 ORDER 为保留字，Doris 侧 ep_ 前缀）
# + 机构维度。七条外键边源库预检全部 0 孤儿，全部在册。
EP_TRANSACTION_RULES = {
    "quality_ep_order_id_not_null": "ods_ep.ep_order",
    "quality_ep_order_id_unique": "ods_ep.ep_order",
    "quality_ep_order_epid_fk": "ods_ep.ep_order",
    "quality_ep_order_patientid_fk": "ods_ep.ep_order",
    "quality_ep_order_paystatus_values": "ods_ep.ep_order",
    "quality_ep_order_item_id_not_null": "ods_ep.ep_order_item",
    "quality_ep_order_item_id_unique": "ods_ep.ep_order_item",
    "quality_ep_order_item_ordersn_fk": "ods_ep.ep_order_item",
    "quality_ep_order_flow_id_not_null": "ods_ep.ep_order_flow",
    "quality_ep_order_flow_id_unique": "ods_ep.ep_order_flow",
    "quality_ep_order_flow_ordersn_fk": "ods_ep.ep_order_flow",
    "quality_ep_order_trade_id_not_null": "ods_ep.ep_order_trade",
    "quality_ep_order_trade_id_unique": "ods_ep.ep_order_trade",
    "quality_ep_order_trade_ordersn_fk": "ods_ep.ep_order_trade",
    "quality_ep_order_relationship_id_not_null": "ods_ep.ep_order_relationship",
    "quality_ep_order_relationship_id_unique": "ods_ep.ep_order_relationship",
    "quality_ep_order_relationship_epid_fk": "ods_ep.ep_order_relationship",
    "quality_ep_order_relationship_valid_values": "ods_ep.ep_order_relationship",
    "quality_ep_order_after_sale_id_not_null": "ods_ep.ep_order_after_sale",
    "quality_ep_order_after_sale_id_unique": "ods_ep.ep_order_after_sale",
    "quality_ep_order_after_sale_ordersn_fk": "ods_ep.ep_order_after_sale",
    "quality_institution_id_not_null": "ods_ep.institution",
    "quality_institution_id_unique": "ods_ep.institution",
    "quality_institution_info_id_not_null": "ods_ep.institution_info",
    "quality_institution_info_id_unique": "ods_ep.institution_info",
}

# G16d 三批规则包：14 表 PK + 6 条干净 FK 边 + 1 值域。脏边（verify_detail→verify
# 1 孤儿、record→drug_catalog 1 孤儿、drug_catalog→institution_drug_catalog 438
# 悬挂）刻意不在册，作为数据质量发现记录于 gate 报告。
EP_DRUG_DOMAIN_RULES = {
    "quality_idc_id_not_null": "ods_ep.institution_drug_catalog",
    "quality_idc_id_unique": "ods_ep.institution_drug_catalog",
    "quality_idc_detail_id_not_null": "ods_ep.institution_drug_catalog_detail",
    "quality_idc_detail_id_unique": "ods_ep.institution_drug_catalog_detail",
    "quality_idc_record_id_not_null": "ods_ep.institution_drug_catalog_record",
    "quality_idc_record_id_unique": "ods_ep.institution_drug_catalog_record",
    "quality_idc_submit_id_not_null": "ods_ep.institution_drug_catalog_submit",
    "quality_idc_submit_id_unique": "ods_ep.institution_drug_catalog_submit",
    "quality_idc_submit_log_id_not_null": "ods_ep.institution_drug_catalog_submit_log",
    "quality_idc_submit_log_id_unique": "ods_ep.institution_drug_catalog_submit_log",
    "quality_idc_verify_id_not_null": "ods_ep.institution_drug_catalog_verify",
    "quality_idc_verify_id_unique": "ods_ep.institution_drug_catalog_verify",
    "quality_idc_verify_detail_id_not_null": "ods_ep.institution_drug_catalog_verify_detail",
    "quality_idc_verify_detail_id_unique": "ods_ep.institution_drug_catalog_verify_detail",
    "quality_drug_database_id_not_null": "ods_ep.drug_database",
    "quality_drug_database_id_unique": "ods_ep.drug_database",
    "quality_drug_catalog_id_not_null": "ods_ep.drug_catalog",
    "quality_drug_catalog_id_unique": "ods_ep.drug_catalog",
    "quality_drug_category_id_not_null": "ods_ep.drug_category",
    "quality_drug_category_id_unique": "ods_ep.drug_category",
    "quality_drugstore_id_not_null": "ods_ep.drugstore",
    "quality_drugstore_id_unique": "ods_ep.drugstore",
    "quality_disease_catalog_id_not_null": "ods_ep.disease_catalog",
    "quality_disease_catalog_id_unique": "ods_ep.disease_catalog",
    "quality_patient_medicine_id_not_null": "ods_ep.patient_medicine",
    "quality_patient_medicine_id_unique": "ods_ep.patient_medicine",
    "quality_patient_address_id_not_null": "ods_ep.patient_address",
    "quality_patient_address_id_unique": "ods_ep.patient_address",
    "quality_idc_detail_submit_id_fk": "ods_ep.institution_drug_catalog_detail",
    "quality_idc_submit_log_submit_id_fk": "ods_ep.institution_drug_catalog_submit_log",
    "quality_idc_verify_submit_id_fk": "ods_ep.institution_drug_catalog_verify",
    "quality_patient_medicine_patient_id_fk": "ods_ep.patient_medicine",
    "quality_patient_address_patient_id_fk": "ods_ep.patient_address",
    "quality_idc_institution_id_fk": "ods_ep.institution_drug_catalog",
    "quality_patient_addr_default_values": "ods_ep.patient_address",
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


def test_ep_transaction_rule_pack_registered():
    catalog = RuleCatalog(str(RULES_FILE))
    by_selector = {rule.selector: rule for rule in catalog.all()}
    for selector, dataset_id in EP_TRANSACTION_RULES.items():
        rule = by_selector.get(selector)
        assert rule is not None, f"G16c 规则缺失：{selector}"
        assert rule.dataset_id == dataset_id
        assert rule.evidence["kind"] in {"not_null", "unique", "accepted_values", "relationships"}
        assert rule.evidence["column"]
    # 交易域证据列白名单不得含患者/收货人身份值列
    for selector in EP_TRANSACTION_RULES:
        rule = by_selector[selector]
        phi_columns = {"PATIENT_NAME", "CONSIGNEE_NAME", "CONSIGNEE_MOBILE", "PATIENT_IDENTITY"}
        listed = {str(col.get("name", "")).upper() for col in rule.evidence.get("columns", [])}
        assert not (listed & phi_columns), f"{selector} 证据列含 PHI：{listed & phi_columns}"


def test_ep_drug_domain_rule_pack_registered():
    catalog = RuleCatalog(str(RULES_FILE))
    by_selector = {rule.selector: rule for rule in catalog.all()}
    for selector, dataset_id in EP_DRUG_DOMAIN_RULES.items():
        rule = by_selector.get(selector)
        assert rule is not None, f"G16d 规则缺失：{selector}"
        assert rule.dataset_id == dataset_id
        assert rule.evidence["kind"] in {"not_null", "unique", "accepted_values", "relationships"}
        assert rule.evidence["column"]
    # 患者地址表为 PHI 表：证据列白名单不含 CONTACT/PHONE/ADDRESS
    addr = by_selector["quality_patient_address_id_unique"]
    listed = {str(col.get("name", "")).upper() for col in addr.evidence.get("columns", [])}
    assert not (listed & {"CONTACT", "PHONE", "ADDRESS"}), f"地址表证据列含 PHI：{listed}"
