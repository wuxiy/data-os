"""RAG 评测契约（G11 A1）：确定性检索、指标手算对拍、可复现、空集边界。"""
import json
from pathlib import Path

import pytest

from conftest import REPO_ROOT
from evaluation import BM25Index, EvalCase, evaluate, evaluate_corpus, load_evalset

EVALSET = REPO_ROOT / "ai-data/eval/medical-rag-evalset.jsonl"


def _chunks():
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))
    import rag_builder as rb
    chunks, _, _ = rb.build(REPO_ROOT / "ai-data/recipes/medical-rag-v1.yaml",
                            REPO_ROOT / "ai-data/documents")
    return chunks


def test_evalset_has_ten_natural_questions():
    cases = load_evalset(EVALSET)
    assert len(cases) == 10
    assert all(c.question and c.expected_document_id for c in cases)


def test_deterministic_and_reproducible():
    chunks = _chunks()
    first = evaluate_corpus(chunks, EVALSET)
    second = evaluate_corpus(chunks, EVALSET)
    first.pop("evaluated_at"), second.pop("evaluated_at")
    assert first == second


def test_metrics_are_explainable_and_hit():
    chunks = _chunks()
    report = evaluate_corpus(chunks, EVALSET)
    # 语料极小（7 chunks / 10 问）：recall 与 citation 应显著命中，但不要求满分
    assert report["eval_set_size"] == 10
    assert report["retrieval_recall_at_5"] > 0.5
    assert 0.0 <= report["mrr"] <= 1.0
    assert len(report["details"]) == 10
    # 每问命中明细可解释（含期望/实际/名次）
    for detail in report["details"]:
        assert {"question", "expected_document_id", "top_document_id", "citation_correct"} <= set(detail)


def test_hand_computed_mrr_on_fixture():
    chunks = [
        {"chunk_id": "a", "document_id": "d1", "section": "s", "content": "高血压诊断阈值 收缩压 140 舒张压 90"},
        {"chunk_id": "b", "document_id": "d2", "section": "s", "content": "手卫生 两前三后 洗手 15 秒"},
    ]
    index = BM25Index(chunks)
    cases = [
        EvalCase("高血压 诊断 阈值", "d1", "s", "高血压诊断阈值 收缩压 140 舒张压 90"),
        EvalCase("飞沫 传播 疾病 隔离", "d3", "s", "不存在的语料"),
    ]
    report = evaluate(index, cases)
    # 问 1：top1 命中 d1（MRR=1、citation=1、faithful=1）；问 2：全 miss（0）
    assert report["mrr"] == 0.5
    assert report["retrieval_recall_at_5"] == 0.5
    assert report["citation_correctness"] == 0.5
    assert report["faithfulness"] == 0.5


def test_empty_corpus_rejected():
    with pytest.raises(RuntimeError, match="语料为空"):
        evaluate_corpus([], EVALSET)
