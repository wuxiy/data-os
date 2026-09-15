"""RAG 数据集工厂契约（G10 gate A1-A5）：解析/去重/PII 对拍/溯源/幂等/版本递增。"""
import json
from pathlib import Path

import pytest
import yaml

from conftest import REPO_ROOT
import rag_builder as rb

AI_DATA = REPO_ROOT / "ai-data"
RECIPE = AI_DATA / "recipes" / "medical-rag-v1.yaml"
DOCUMENTS = AI_DATA / "documents"


@pytest.fixture(scope="module")
def built():
    return rb.build(RECIPE, DOCUMENTS)


def test_recipe_pipeline_matches_reference(built):
    chunks, artifacts, stats = built
    manifest = artifacts["manifest"]
    assert manifest["metadata"]["recipe"] == "medical-rag-v1"
    assert manifest["spec"]["lineage"]["git_commit"]  # 非空（unknown 也可，本地有 git）
    assert manifest["spec"]["privacy"]["deidentified"] is True


def test_html_structure_preserved():
    blocks = rb.document_parse(DOCUMENTS / "hypertension-guideline.html")
    headings = [b for b in blocks if b["kind"] == "heading"]
    paragraphs = [b for b in blocks if b["kind"] == "paragraph"]
    assert [h["text"] for h in headings] == [
        "高血压临床诊疗指南（合成版·2026）", "概述", "分级标准", "治疗原则"]
    assert len(paragraphs) >= 5  # 各节段落齐


def test_deduplicate_drops_duplicate_document(built):
    chunks, artifacts, stats = built
    assert stats.documents_in == 9  # 9 篇 HTML（含 1 篇重复 + G12 飞轮补强篇；sidecar 不计）
    assert stats.documents_unique == 8
    assert stats.duplicates_dropped == 1
    names = artifacts["manifest"]["spec"]["source"]["documents"]
    assert "hypertension-guideline-duplicate.html" not in names


def test_pii_detection_matches_expected_sidecar(built):
    chunks, artifacts, stats = built
    sidecar = json.loads((DOCUMENTS / "expected_phi.json").read_text(encoding="utf-8"))
    expected_total = sum(len(v) for v in sidecar["expected_hits"].values())
    assert stats.pii_hits == expected_total == 6
    # 命中文档与 sidecar 一致
    assert sorted(set(stats.phi_documents)) == sorted(sidecar["expected_hits"].keys())
    # 替换后产物中无任何原始 PHI 残留；占位符在
    text = "\n".join(c["content"] for c in chunks)
    for hits in sidecar["expected_hits"].values():
        for token in hits:
            assert token not in text
    assert "<PHONE>" in text and "<IDCARD>" in text


def test_every_chunk_is_attributed(built):
    chunks, artifacts, stats = built
    assert stats.chunks > 0
    for chunk in chunks:
        assert chunk["document_id"], "document_id 缺失"
        assert isinstance(chunk["source_offset"], int), "source_offset 缺失"
        assert chunk["section"], "section 缺失"
        assert chunk["content"].strip()


def test_idempotent_build(built):
    again = rb.build(RECIPE, DOCUMENTS)
    ids_first = [c["chunk_id"] for c in built[0]]
    ids_again = [c["chunk_id"] for c in again[0]]
    assert ids_first == ids_again


def test_pipeline_is_consumed_not_decorative(tmp_path):
    """声明=行为：去掉 deidentification 步后，产物保留原文 PII、计数归零。"""
    recipe = yaml.safe_load(RECIPE.read_text(encoding="utf-8"))
    recipe["spec"]["pipeline"] = [op for op in recipe["spec"]["pipeline"]
                                  if op != "deidentification"]
    path = tmp_path / "recipe-nodeid.yaml"
    path.write_text(yaml.safe_dump(recipe, allow_unicode=True), encoding="utf-8")
    chunks, _, stats = rb.build(path, DOCUMENTS)
    text = "\n".join(c["content"] for c in chunks)
    sidecar = json.loads((DOCUMENTS / "expected_phi.json").read_text(encoding="utf-8"))
    for hits in sidecar["expected_hits"].values():
        for token in hits:
            assert token in text  # 未声明脱敏算子 -> 原文保留
    assert stats.pii_hits == 0
    assert "<PHONE>" not in text


def test_unknown_pipeline_operator_fails_loudly(tmp_path):
    recipe = yaml.safe_load(RECIPE.read_text(encoding="utf-8"))
    recipe["spec"]["pipeline"] = ["document_parse", "magic_op"]
    path = tmp_path / "recipe-bad.yaml"
    path.write_text(yaml.safe_dump(recipe, allow_unicode=True), encoding="utf-8")
    with pytest.raises(RuntimeError, match="未实现算子"):
        rb.build(path, DOCUMENTS)


# ---- G17 AI-2：doris_table 源（真实采集语料）----

EP_RECIPE = AI_DATA / "recipes" / "ep-prescription-rag-v1.yaml"


class StubTableDoris:
    """表源读取桩：按 SQL 中的表名返回处方主表/明细行，记录全部查询。"""

    def __init__(self, header_rows, detail_rows):
        self._header = header_rows
        self._detail = detail_rows
        self.queries: list[str] = []

    def query(self, sql, args):
        self.queries.append(sql)
        return list(self._detail) if "ep_mz_ypcfmx" in sql else list(self._header)


def ep_stub_adapter(duplicate=False):
    header = ("CF001", "XX人民医院", "心血管内科", "2026-08-01 10:00:00", "男", "45", "岁",
              "原发性高血压", "I10.x00", "头晕乏力", 3, 7, "长期服药")
    if duplicate:
        header_rows = [header, header]
    else:
        header_rows = [header]
    detail_rows = [
        ("CF001", "苯磺酸氨氯地平片", "5mg*28片", "口服", "每日一次", "5", "mg", "1", "盒", "28"),
        ("CF001", "阿司匹林肠溶片", "100mg*30片", "口服", "每日一次", "100", "mg", "1", "盒", "30"),
    ]
    return StubTableDoris(header_rows, detail_rows)


def test_table_serialize_only_reads_declared_columns():
    """PHI 排除纪律的执行点：未声明的标识符列不出现在任何 SQL 里。"""
    adapter = ep_stub_adapter()
    source = yaml.safe_load(EP_RECIPE.read_text(encoding="utf-8"))["spec"]["source"]
    documents = rb.table_serialize(adapter, source)
    joined = "\n".join(adapter.queries)
    for banned in ("HZXM", "LXFS", "PATIENT_ID", "JZLSH", "KFYSGH", "KFYSXM", "BIZ_NO", "KH", "KLX"):
        assert banned not in joined, f"标识符列 {banned} 不应被查询"
    assert len(documents) == 1
    text = "".join(block["text"] for block in documents[0]["blocks"])
    assert documents[0]["blocks"][0]["kind"] == "heading"  # 科室承载 section
    assert "机构：XX人民医院" in text and "科室：心血管内科" in text
    assert "药品 苯磺酸氨氯地平片" in text and "用法 口服" in text
    assert text.endswith("。")  # 断句在场（chunk_quality_score 口径）


def test_date_only_columns_truncate_time_component():
    """G18 飞轮 v1.1：时序列截到日期位（时分秒稀释日期 token 判别力）。"""
    adapter = ep_stub_adapter()
    source = yaml.safe_load(EP_RECIPE.read_text(encoding="utf-8"))["spec"]["source"]
    source["date_only_columns"] = ["KFRQ"]
    documents = rb.table_serialize(adapter, source)
    text = documents[0]["blocks"][-1]["text"]
    assert "开方日期：2026-08-01。" in text or "开方日期：2026-08-01；" in text
    assert "10:00:00" not in text
    # 未声明时保留完整时间戳（v1 行为）
    adapter_v1 = ep_stub_adapter()
    source.pop("date_only_columns")
    text_v1 = rb.table_serialize(adapter_v1, source)[0]["blocks"][-1]["text"]
    assert "10:00:00" in text_v1


def test_build_with_doris_table_source_end_to_end():
    chunks, artifacts, stats = rb.build(EP_RECIPE, None, adapter=ep_stub_adapter())
    assert stats.documents_in == 1 and stats.chunks >= 1
    chunk = chunks[0]
    assert chunk["document_id"] and chunk["section"]
    assert chunk["quality_score"] >= 1.0  # 单处方文本落在长度窗口且含断句
    assert chunk["recipe_version"] == "1.0.0"
    manifest = artifacts["manifest"]
    assert manifest["spec"]["source"] == {"table": "ods_ep.ep_mz_cfzb", "limit": 2000, "documents": 1}
    assert manifest["spec"]["privacy"]["deidentified"] is True


def test_build_with_doris_table_source_dedups_identical_prescriptions():
    chunks, artifacts, stats = rb.build(EP_RECIPE, None, adapter=ep_stub_adapter(duplicate=True))
    assert stats.documents_in == 2 and stats.documents_unique == 1
    assert stats.duplicates_dropped == 1


def test_table_source_requires_matching_pipeline(tmp_path):
    recipe = yaml.safe_load(EP_RECIPE.read_text(encoding="utf-8"))
    # 源声明了 doris_table 但 pipeline 缺 table_serialize -> 拒绝
    recipe["spec"]["pipeline"] = [op for op in recipe["spec"]["pipeline"] if op != "table_serialize"]
    path = tmp_path / "ep-noop.yaml"
    path.write_text(yaml.safe_dump(recipe, allow_unicode=True), encoding="utf-8")
    with pytest.raises(RuntimeError, match="table_serialize"):
        rb.build(path, None, adapter=ep_stub_adapter())
    # documents 源混入 table_serialize -> 同样拒绝
    recipe2 = yaml.safe_load(RECIPE.read_text(encoding="utf-8"))
    recipe2["spec"]["pipeline"] = ["table_serialize"] + recipe2["spec"]["pipeline"]
    path2 = tmp_path / "mixed.yaml"
    path2.write_text(yaml.safe_dump(recipe2, allow_unicode=True), encoding="utf-8")
    with pytest.raises(RuntimeError, match="非 doris_table"):
        rb.build(path2, DOCUMENTS)


def test_doris_table_source_without_adapter_fails_loudly():
    with pytest.raises(RuntimeError, match="adapter"):
        rb.build(EP_RECIPE, None)


class FakeS3:
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    class exceptions:
        class ClientError(Exception):
            pass

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise self.exceptions.ClientError("404")
        return {}

    def put_object(self, Bucket, Key, Body):
        assert Key not in self.objects, f"版本不可覆盖被违反：{Key}"
        self.objects[Key] = Body


def test_version_increments_and_never_overwrites(built):
    chunks, artifacts, stats = built
    s3 = FakeS3()
    v1 = rb.next_version(s3, "b", "p")
    assert v1 == "v1.0.0"
    rb.write_rustfs(s3, "b", "p", v1, chunks, artifacts)
    v2 = rb.next_version(s3, "b", "p")
    assert v2 == "v1.0.1"
    # 第二次写同版本必须被拒（不可覆盖）
    with pytest.raises(AssertionError):
        rb.write_rustfs(s3, "b", "p", v1, chunks, artifacts)


def test_artifact_bundle_complete(built):
    chunks, artifacts, stats = built
    manifest = artifacts["manifest"]
    quality = artifacts["quality"]
    assert {"metadata", "spec"} <= set(manifest)
    assert manifest["metadata"]["recipe_version"] == "1.0.0"
    for key in ("documents", "pii", "chunks"):
        assert key in quality
    assert quality["chunks"]["total"] == stats.chunks


class RecordingDoris:
    def __init__(self):
        self.rows = []

    def query(self, sql, args):
        self.rows.append(args)
        return []


def test_doris_writer_uses_unique_key_rows(built):
    chunks, _, _ = built
    adapter = RecordingDoris()
    written = rb.write_doris(chunks, adapter, "dataos_ai.chunks")
    assert written == len(chunks)
    assert all(len(row) == 8 for row in adapter.rows)
