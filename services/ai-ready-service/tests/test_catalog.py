"""声明仓库契约（A1）：真实 ai-ready/ 仓库全量加载与一致性。"""
import pytest

from catalog import CatalogError, load_catalog
from conftest import REPO


@pytest.fixture(scope="module")
def catalog():
    return load_catalog(str(REPO))


def test_loads_ten_requirements(catalog):
    assert len(catalog.requirements) == 10
    by_dimension = {}
    for requirement in catalog.requirements.values():
        by_dimension[requirement.dimension] = by_dimension.get(requirement.dimension, 0) + 1
    # 六维覆盖：clean 3 / current 1 / contextual 1 / consumable 1 / correlated 1 / compliant 3
    assert by_dimension == {"clean": 3, "current": 1, "contextual": 1,
                            "consumable": 1, "correlated": 1, "compliant": 3}


def test_both_profiles_reference_all_requirements(catalog):
    for profile_id in ("medical-rag", "medical-training"):
        assert len(catalog.requirement_ids(profile_id)) == 10


def test_critical_severity_set(catalog):
    critical = {rid for rid, req in catalog.requirements.items() if req.severity == "critical"}
    assert critical == {"pii_classification", "deidentification", "patient_split_leakage"}


def test_gate_thresholds(catalog):
    thresholds = catalog.gate_thresholds("medical-rag")
    assert thresholds == {"fail_below": 0.70, "review_below": 0.85}


def test_orphan_requirement_is_rejected(tmp_path):
    (tmp_path / "requirements" / "clean" / "orphan").mkdir(parents=True)
    (tmp_path / "requirements" / "clean" / "orphan" / "requirement.yaml").write_text(
        "id: orphan\ntitle: 孤儿\ndimension: clean\nseverity: minor\n"
        "applicable_profiles: [medical-rag]\ndiagnostic: x\n"
        "check: {type: om_probe, probe: lineage_edge_coverage, service: doris-dataos, "
        "root: doris-dataos.default.ods_ep.ep_mz_cfzb, direction: higher_better, pass: 1.0, warn: 0.5}\n",
        encoding="utf-8")
    (tmp_path / "profiles").mkdir()
    (tmp_path / "profiles" / "p.yaml").write_text(
        "id: p\nname: p\nrequirements: {}\nthresholds: {fail_below: 0.7, review_below: 0.85}\n",
        encoding="utf-8")
    with pytest.raises(CatalogError, match="未.*引用"):
        load_catalog(str(tmp_path))


def test_unknown_probe_rejected_at_load(tmp_path):
    """声明 typo（探针名/必需键/未知类型）装载期即爆，不冒充评估 FAIL。"""
    (tmp_path / "requirements" / "compliant").mkdir(parents=True)
    req_dir = tmp_path / "requirements" / "compliant" / "typo-probe"
    req_dir.mkdir()
    (req_dir / "requirement.yaml").write_text(
        "id: typo_probe\ntitle: t\ndimension: compliant\nseverity: major\n"
        "applicable_profiles: [p]\ndiagnostic: d\n"
        "check: {type: om_probe, probe: table_description_covarage, service: doris-dataos, "
        "schemas: [ods_ep], direction: higher_better, pass: 1.0, warn: 0.5}\n",
        encoding="utf-8")
    (tmp_path / "profiles").mkdir()
    (tmp_path / "profiles" / "p.yaml").write_text(
        "id: p\nname: p\nrequirements: {typo_probe: 1.0}\n"
        "thresholds: {fail_below: 0.7, review_below: 0.85}\n",
        encoding="utf-8")
    with pytest.raises(CatalogError, match="探针未知"):
        load_catalog(str(tmp_path))


def test_missing_probe_key_rejected_at_load(tmp_path):
    (tmp_path / "requirements" / "compliant").mkdir(parents=True)
    req_dir = tmp_path / "requirements" / "compliant" / "missing-key"
    req_dir.mkdir()
    (req_dir / "requirement.yaml").write_text(
        "id: missing_key\ntitle: t\ndimension: compliant\nseverity: major\n"
        "applicable_profiles: [p]\ndiagnostic: d\n"
        "check: {type: om_probe, probe: pii_tag_coverage, service: doris-dataos, "
        "direction: higher_better, pass: 1.0, warn: 0.5}\n",
        encoding="utf-8")
    (tmp_path / "profiles").mkdir()
    (tmp_path / "profiles" / "p.yaml").write_text(
        "id: p\nname: p\nrequirements: {missing_key: 1.0}\n"
        "thresholds: {fail_below: 0.7, review_below: 0.85}\n",
        encoding="utf-8")
    with pytest.raises(CatalogError, match="缺少 table"):
        load_catalog(str(tmp_path))
