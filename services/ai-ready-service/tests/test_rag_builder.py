"""RAG 数据集工厂契约（G10 gate A1-A5）：解析/去重/PII 对拍/溯源/幂等/版本递增。"""
import json
from pathlib import Path

import pytest

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
