"""RAG 评测（G11）：轻量 BM25 检索 + 五指标（确定性、可复现）。

指标口径（合成 eval set，架构总计划 Gate 11）：
- Retrieval Recall@5    期望 chunk 是否出现在 top5
- Precision@5           top5 中与期望同 document_id 的占比
- MRR                   期望 chunk 首次命中的倒数排名
- Citation Correctness  top1 的 document_id 与期望一致占比（引用正确性）
- Faithfulness（规则版）golden 句是否被 top1 片段包含（答案可由证据支撑）
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


def tokenize(text: str) -> list[str]:
    # 中文按 2-gram + 英数词；确定性分词，无外置依赖
    tokens = re.findall(r"[A-Za-z0-9]+", text.lower())
    clean = re.sub(r"[^\w\u4e00-\u9fff]+", "", text)
    bigrams = [clean[i:i + 2] for i in range(len(clean) - 1)]
    return tokens + bigrams


@dataclass
class RetrievedChunk:
    chunk_id: str
    document_id: str
    section: str
    content: str
    score: float


class BM25Index:
    def __init__(self, chunks: list[dict], k1: float = 1.5, b: float = 0.75):
        self._k1, self._b = k1, b
        self._docs = [tokenize(c["content"]) for c in chunks]
        self._chunks = chunks
        self._df: dict[str, int] = {}
        for tokens in self._docs:
            for token in set(tokens):
                self._df[token] = self._df.get(token, 0) + 1
        self._avgdl = sum(len(t) for t in self._docs) / max(len(self._docs), 1) or 1.0
        self._tf = [dict() for _ in self._docs]
        for i, tokens in enumerate(self._docs):
            for token in tokens:
                self._tf[i][token] = self._tf[i].get(token, 0) + 1

    def search(self, query: str, top_k: int = 5) -> list[RetrievedChunk]:
        tokens = tokenize(query)
        n = len(self._docs)
        scored: list[tuple[float, int]] = []
        for i in range(n):
            score = 0.0
            for token in tokens:
                tf = self._tf[i].get(token, 0)
                if not tf:
                    continue
                df = self._df.get(token, 0)
                idf = math.log((n - df + 0.5) / (df + 0.5) + 1.0)
                score += idf * tf * (self._k1 + 1) / (
                    tf + self._k1 * (1 - self._b + self._b * len(self._docs[i]) / self._avgdl))
            if score > 0:
                scored.append((score, i))
        scored.sort(key=lambda pair: (-pair[0], pair[1]))  # 稳定：同分按序
        return [RetrievedChunk(self._chunks[i]["chunk_id"], self._chunks[i]["document_id"],
                               self._chunks[i].get("section") or "", self._chunks[i]["content"], s)
                for s, i in scored[:top_k]]


@dataclass
class EvalCase:
    question: str
    expected_document_id: str
    expected_section: str
    golden_sentence: str


def load_evalset(path: Path) -> list[EvalCase]:
    cases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        cases.append(EvalCase(row["question"], row["expected_document_id"],
                              row.get("expected_section", ""), row.get("golden_sentence", "")))
    return cases


def evaluate(index: BM25Index, cases: list[EvalCase], top_k: int = 5) -> dict:
    recall_hits = precision_total = precision_hits = mrr_sum = 0
    citation_hits = faith_hits = 0
    details = []
    for case in cases:
        results = index.search(case.question, top_k)
        ranks = [r + 1 for r, item in enumerate(results)
                 if item.document_id == case.expected_document_id]
        hit = bool(ranks)
        recall_hits += hit
        same_doc = sum(1 for item in results if item.document_id == case.expected_document_id)
        precision_total += len(results)
        precision_hits += same_doc
        mrr_sum += 1.0 / ranks[0] if ranks else 0.0
        top1 = results[0] if results else None
        citation_ok = bool(top1 and top1.document_id == case.expected_document_id)
        citation_hits += citation_ok
        faithful = bool(top1 and case.golden_sentence
                        and case.golden_sentence.strip() in top1.content)
        faith_hits += faithful
        details.append({
            "question": case.question,
            "expected_document_id": case.expected_document_id,
            "top_document_id": top1.document_id if top1 else None,
            "first_match_rank": ranks[0] if ranks else None,
            "citation_correct": citation_ok,
            "faithful": faithful,
        })
    total = max(len(cases), 1)
    return {
        "eval_set_size": len(cases),
        "retrieval_recall_at_5": round(recall_hits / total, 4),
        "precision_at_5": round(precision_hits / max(precision_total, 1), 4),
        "mrr": round(mrr_sum / total, 4),
        "citation_correctness": round(citation_hits / total, 4),
        "faithfulness": round(faith_hits / total, 4),
        "details": details,
        "evaluated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def evaluate_corpus(chunks: list[dict], evalset_path: Path) -> dict:
    if not chunks:
        raise RuntimeError("语料为空：先完成构建（rag_builder）再评测")
    return evaluate(BM25Index(chunks), load_evalset(evalset_path))
