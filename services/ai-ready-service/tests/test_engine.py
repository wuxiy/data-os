"""引擎契约（A3/A4/A5）：聚合对拍、一票否决、N/A 剔除、幂等、CLI 样式。

Stub 探针按 requirement id 注入固定指标，与真实 Adapter 同接口。
"""
from catalog import load_catalog
from conftest import REPO, StubDoris, StubOm, StubRustfs, all_pass_metrics
from engine import Engine, render_cli

def make_engine(metrics: dict[str, float], tables: set[str] | None = None) -> Engine:
    catalog = load_catalog(str(REPO))
    return Engine(catalog, StubDoris(metrics, tables), StubOm(metrics))


def test_all_pass_yields_full_score_candidate():
    report = make_engine(all_pass_metrics()).assess("p", "v0.1.0", "medical-rag")
    assert report.overall == 1.0
    assert report.gate.result == "PASS" and report.gate.certification == "CANDIDATE"
    # chunk 三项与 leakage 表不存在 -> N/A，不参与聚合（consumable 维整体缺位）
    statuses = {item.id: item.status for item in report.requirements}
    assert statuses["chunk_source_attribution"] == "NOT_APPLICABLE"
    assert statuses["chunk_deduplication"] == "NOT_APPLICABLE"
    assert statuses["chunk_quality_share"] == "NOT_APPLICABLE"
    assert statuses["patient_split_leakage"] == "NOT_APPLICABLE"
    assert "consumable" not in report.dimensions


def test_aggregation_matches_hand_computed():
    # data_completeness FAIL（null_ratio 0.10 > warn 0.05），其余全 PASS
    metrics = all_pass_metrics() | {"null_ratio": 0.10}
    report = make_engine(metrics).assess("p", "v0.1.0", "medical-rag")
    # clean = (0*1.0 + 1.0*0.8 + 1.0*0.8) / 2.6 = 0.6154
    assert report.dimensions["clean"] == 0.6154
    # overall = (0.6154 + 1.0*4) / 5（consumable 为 N/A 剔除）
    assert report.overall == 0.9231
    assert report.gate.result == "PASS"
    assert report.problems["FAIL"] == ["data_completeness"]


def test_warn_scores_half():
    # contextual 两探针同时 WARN（G17 补厚后为双成员）：维度分 = 0.5
    metrics = all_pass_metrics() | {"semantic_documentation": 0.6, "column_description_coverage": 0.6}
    report = make_engine(metrics).assess("p", "v0.1.0", "medical-rag")
    assert report.dimensions["contextual"] == 0.5
    assert report.problems["WARN"] == ["semantic_documentation", "column_description_coverage"]


def test_review_band():
    # contextual（双探针）与 correlated（双探针）全 WARN：
    # overall = (1 + 0.5 + 0.5 + 1 + 1)/5 = 0.8 -> REVIEW（consumable 为 N/A 剔除）
    metrics = all_pass_metrics() | {"semantic_documentation": 0.6, "column_description_coverage": 0.6,
                                    "lineage_completeness": 0.6}
    report = make_engine(metrics).assess("p", "v0.1.0", "medical-rag")
    assert report.overall == 0.8
    assert report.gate.result == "REVIEW" and report.gate.certification == "REVIEW_REQUIRED"


def test_critical_failure_blocks_certification():
    # 总分满分路径，但 deidentification 命中明文（critical FAIL）-> BLOCKED
    metrics = all_pass_metrics() | {"plaintext_hit_ratio": 0.5}
    report = make_engine(metrics).assess("p", "v0.1.0", "medical-rag")
    assert report.gate.result == "PASS"
    assert report.gate.certification == "BLOCKED"
    assert report.gate.critical_failures == ["deidentification"]


def test_fail_band_below_threshold():
    metrics = all_pass_metrics() | {
        "null_ratio": 0.10, "trusted_ratio": 0.5, "coverage_ratio": 0.9,
        "hours_since_update": 200.0, "semantic_documentation": 0.3,
        "column_description_coverage": 0.2, "lineage_completeness": 0.0,
        "pii_classification": 0.5,
    }
    report = make_engine(metrics).assess("p", "v0.1.0", "medical-rag")
    assert report.overall < 0.70
    assert report.gate.result == "FAIL"


def test_idempotent_reports_differ_only_by_timestamp():
    engine = make_engine(all_pass_metrics() | {"null_ratio": 0.03})
    first = engine.assess("p", "v0.1.0", "medical-rag")
    second = engine.assess("p", "v0.1.0", "medical-rag")
    first.assessed_at = second.assessed_at = ""
    assert first.model_dump() == second.model_dump()


def test_profile_weights_change_aggregation():
    # medical-training 对 data_completeness 权重更高：同 FAIL 下 clean 维分更低
    rag = make_engine(all_pass_metrics() | {"null_ratio": 0.10}).assess("p", "v0.1.0", "medical-rag")
    training = make_engine(all_pass_metrics() | {"null_ratio": 0.10}).assess("p", "v0.1.0", "medical-training")
    # rag: (0*1.0 + 0.8 + 0.8)/2.6 = 0.6154; training: (0*1.2 + 1.0 + 1.0)/3.2 = 0.625
    assert rag.dimensions["clean"] == 0.6154
    assert training.dimensions["clean"] == 0.625


def test_probe_error_fails_the_requirement():
    class BrokenOm(StubOm):
        def pii_tag_coverage(self, check: dict) -> float:
            raise RuntimeError("OM 不可达")
    from catalog import load_catalog
    catalog = load_catalog(str(REPO))
    engine = Engine(catalog, StubDoris(all_pass_metrics()), BrokenOm(all_pass_metrics()))
    report = engine.assess("p", "v0.1.0", "medical-rag")
    statuses = {item.id: item.status for item in report.requirements}
    assert statuses["pii_classification"] == "FAIL"
    assert "探针执行失败" in next(item.note for item in report.requirements
                                  if item.id == "pii_classification")


def test_cli_render_matches_reference_layout():
    report = make_engine(all_pass_metrics() | {"semantic_documentation": 0.6,
                                               "column_description_coverage": 0.6,
                                               "lineage_completeness": 0.6}).assess(
        "medical-rag-diagnosis", "1.2.0", "medical-rag")
    text = render_cli(report)
    assert text.startswith("AI Ready Assessment")
    assert "Product:\nmedical-rag-diagnosis" in text
    assert "Version:\n1.2.0" in text
    assert "Profile:\nmedical-rag" in text
    for label in ("Clean", "Contextual", "Consumable", "Current", "Correlated", "Compliant"):
        assert label in text or label == "Consumable"  # Consumable N/A 时可不出现
    assert "Overall" in text
    assert "Result:\nREVIEW_REQUIRED" in text
    assert "- semantic_documentation" in text


def test_second_batch_checks_with_chunks_table_present():
    """G20 第二批：产物表在册时 corpus_source_lag（SQL）/ artifact_availability（rustfs
    探针）真实生效，fhir_mapping 维持条件 N/A；17 项全 PASS 时 Overall 1.0。"""
    catalog = load_catalog(str(REPO))
    engine = Engine(catalog, StubDoris(all_pass_metrics(), {"dataos_ai.chunks_ep"}),
                    StubOm(all_pass_metrics()), StubRustfs(all_pass_metrics()))
    report = engine.assess("p", "v0.3.0", "medical-rag")
    statuses = {item.id: item.status for item in report.requirements}
    assert statuses["corpus_source_lag"] == "PASS"
    assert statuses["artifact_availability"] == "PASS"
    assert statuses["fhir_mapping_coverage"] == "NOT_APPLICABLE"
    assert statuses["patient_split_leakage"] == "NOT_APPLICABLE"
    assert len(report.requirements) == 17
    assert report.overall == 1.0
    assert report.gate.certification == "CANDIDATE"


def test_rustfs_probe_without_adapter_fails_requirement():
    catalog = load_catalog(str(REPO))
    engine = Engine(catalog, StubDoris(all_pass_metrics(), {"dataos_ai.chunks_ep"}),
                    StubOm(all_pass_metrics()))
    report = engine.assess("p", "v0.3.0", "medical-rag")
    statuses = {item.id: item.status for item in report.requirements}
    assert statuses["artifact_availability"] == "FAIL"
    assert "RustFS 探针未装配" in next(item.note for item in report.requirements
                                       if item.id == "artifact_availability")


def test_requires_table_guard_precedes_rustfs_probe():
    """requires_table 守卫对 rustfs_probe 前置：产物表不在册即 N/A，探针不被调用。"""
    class ExplodingRustfs(StubRustfs):
        def artifact_availability(self, check: dict) -> float:
            raise AssertionError("产物表不在册时探针不应被调用")
    catalog = load_catalog(str(REPO))
    engine = Engine(catalog, StubDoris(all_pass_metrics()), StubOm(all_pass_metrics()),
                    ExplodingRustfs(all_pass_metrics()))
    report = engine.assess("p", "v0.3.0", "medical-rag")
    statuses = {item.id: item.status for item in report.requirements}
    assert statuses["artifact_availability"] == "NOT_APPLICABLE"
