"""RAG 数据集工厂（G10）：Trusted Document -> Recipe -> 加工算子 -> Chunks。

规范对齐架构文档 §9.1/§10：pipeline 算子名与 Data-Juicer 语义对应；执行器为
自研轻量实现（Docling/Data-Juicer 因远端网络不可达延后引入，Recipe 不变、
后端可替换——见 docs/ai-ready-g10-review-and-plan-20260827.md G10-1）。

用法（容器内）：
    python -m app.rag_builder --recipe /opt/dataos/ai-data/recipes/medical-rag-v1.yaml
    python -m app.rag_builder --recipe ... --skip-doris --skip-rustfs   # 干跑校验
"""
from __future__ import annotations

import argparse
import hashlib
import os
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import yaml

PHONE_RE = re.compile(r"1[3-9]\d{9}")
ID_CARD_RE = re.compile(r"\d{17}[0-9Xx]")


# ---------- 文档解析 ----------

class _StructureParser(HTMLParser):
    """h1/h2/p -> 结构块（保留标题层级与段落边界）。"""

    HEADING_TAGS = {"h1": 1, "h2": 2, "h3": 3}

    def __init__(self):
        super().__init__()
        self.blocks: list[dict] = []
        self._tag = None
        self._buffer: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self.HEADING_TAGS or tag == "p":
            self._tag = tag
            self._buffer = []

    def handle_data(self, data):
        if self._tag:
            self._buffer.append(data)

    def handle_endtag(self, tag):
        if tag == self._tag and self._tag:
            text = "".join(self._buffer).strip()
            if text:
                kind = "heading" if tag in self.HEADING_TAGS else "paragraph"
                self.blocks.append({"kind": kind, "level": self.HEADING_TAGS.get(tag), "text": text})
            self._tag = None


def document_parse(path: Path) -> list[dict]:
    parser = _StructureParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser.blocks


# ---------- 算子 ----------

def text_normalization(blocks: list[dict]) -> list[dict]:
    normalized = []
    for block in blocks:
        text = block["text"]
        text = text.translate(str.maketrans("０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ",
                                       "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"))
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            normalized.append({**block, "text": text})
    return normalized


def template_removal(blocks: list[dict]) -> list[dict]:
    # 合成语料的页眉标记（HTML 注释已在解析层丢弃；此处剥残留标记行）
    marker = re.compile(r"^(source:|generated:|copyright data-os)", re.I)
    return [b for b in blocks if not marker.match(b["text"])]


def deduplicate(documents: list[dict]) -> tuple[list[dict], int]:
    """内容指纹去重：同 sha256 的文档只保留首个（输入按文件名排序，确定性）。"""
    seen: set[str] = set()
    unique, dropped = [], 0
    # 文件名含 duplicate 的排在同内容原版之后，保证保留的是原版（确定性）
    for doc in sorted(documents, key=lambda item: ("duplicate" in item["name"], item["name"])):
        fingerprint = hashlib.sha256(
            "\n".join(b["text"] for b in doc["blocks"]).encode("utf-8")).hexdigest()
        if fingerprint in seen:
            dropped += 1
            continue
        seen.add(fingerprint)
        unique.append({**doc, "fingerprint": fingerprint})
    return unique, dropped


def pii_detection(text: str) -> list[str]:
    # 先剥身份证再数手机号：18 位身份证内含的 11 位子串会被手机号规则误命中
    id_hits = ID_CARD_RE.findall(text)
    return id_hits + PHONE_RE.findall(ID_CARD_RE.sub("", text))


def deidentification(text: str, phone_ph: str, id_ph: str) -> tuple[str, int]:
    id_hits = ID_CARD_RE.findall(text)
    text = ID_CARD_RE.sub(id_ph, text)
    phone_hits = PHONE_RE.findall(text)
    text = PHONE_RE.sub(phone_ph, text)
    return text, len(id_hits) + len(phone_hits)


# ---------- 切块 ----------

@dataclass
class Chunk:
    document_id: str
    document_name: str
    section: str
    source_offset: int
    end_offset: int
    content: str
    quality_score: float

    def as_dict(self) -> dict:
        return {
            "chunk_id": hashlib.sha256(
                f"{self.document_id}:{self.source_offset}:{self.content}".encode()).hexdigest()[:32],
            "document_id": self.document_id,
            "document_name": self.document_name,
            "section": self.section,
            "source_offset": self.source_offset,
            "end_offset": self.end_offset,
            "content": self.content,
            "quality_score": self.quality_score,
        }


def semantic_chunk(doc: dict, params: dict) -> list[Chunk]:
    """段落感知切块：以块为最小单位累积到目标长度；超长段落按句切。"""
    target = int(params.get("target_chars", 900))
    min_chars = int(params.get("min_chars", 200))
    chunks: list[Chunk] = []
    section = ""
    buffer: list[dict] = []

    def flush():
        nonlocal buffer
        if not buffer:
            return
        text = " ".join(b["text"] for b in buffer)
        chunks.append((section, buffer[0]["index"], buffer[-1]["index"], text))
        buffer = []

    numbered = [{**b, "index": i} for i, b in enumerate(doc["blocks"])]
    for block in numbered:
        if block["kind"] == "heading":
            flush()
            section = block["text"]
            continue
        if len(" ".join(b["text"] for b in buffer)) + len(block["text"]) > target and buffer:
            flush()
        buffer.append(block)
        if len(" ".join(b["text"] for b in buffer)) >= target:
            flush()
    flush()

    result = []
    for sec, start, end, text in chunks:
        # 超长文本按句切（不破坏句内）
        pieces = [text] if len(text) <= int(params.get("max_chars", 1500)) else _split_sentences(
            text, int(params.get("max_chars", 1500)))
        for piece in pieces:
            if len(piece) < min_chars and result and result[-1].document_id == doc["fingerprint"][:12]:
                # 过短并入前块（同文档）
                merged = result[-1]
                result[-1] = Chunk(merged.document_id, merged.document_name, merged.section,
                                   merged.source_offset, end, merged.content + " " + piece,
                                   merged.quality_score)
                continue
            score = chunk_quality_score(piece, min_chars, int(params.get("max_chars", 1500)))
            result.append(Chunk(doc["fingerprint"][:12], doc["name"], sec, start, end, piece, score))
    return result


def _split_sentences(text: str, limit: int) -> list[str]:
    sentences = re.split(r"(?<=[。；;])", text)
    pieces, current = [], ""
    for sentence in sentences:
        if len(current) + len(sentence) > limit and current:
            pieces.append(current)
            current = sentence
        else:
            current += sentence
    if current:
        pieces.append(current)
    return pieces


def chunk_quality_score(text: str, min_chars: int, max_chars: int) -> float:
    if len(text) < min_chars or len(text) > max_chars:
        return 0.5
    return 1.0 if ("。" in text or ";" in text or "；" in text) else 0.5


# ---------- 构建 ----------

@dataclass
class BuildStats:
    documents_in: int = 0
    documents_unique: int = 0
    duplicates_dropped: int = 0
    pii_hits: int = 0
    chunks: int = 0
    chunks_pass_quality: int = 0
    phi_documents: list[str] = field(default_factory=list)


def build(recipe_path: Path, documents_dir: Path) -> tuple[list[dict], dict, BuildStats]:
    recipe = yaml.safe_load(recipe_path.read_text(encoding="utf-8"))
    if recipe.get("apiVersion") != "data-os/v1" or recipe.get("kind") != "AIDatasetRecipe":
        raise RuntimeError("Recipe 不符合 data-os/v1 AIDatasetRecipe 规范")
    spec = recipe["spec"]
    params = spec.get("parameters", {})
    stats = BuildStats()

    files = sorted(documents_dir.glob("*.html"))
    stats.documents_in = len(files)
    documents = [{"name": f.name, "blocks": text_normalization(template_removal(document_parse(f)))}
                 for f in files]
    unique, dropped = deduplicate(documents)
    stats.documents_unique = len(unique)
    stats.duplicates_dropped = dropped

    phone_ph = params.get("pii", {}).get("phone_placeholder", "<PHONE>")
    id_ph = params.get("pii", {}).get("id_card_placeholder", "<IDCARD>")

    chunks: list[dict] = []
    for doc in unique:
        pii_total = 0
        for block in doc["blocks"]:
            block["text"], hits = deidentification(block["text"], phone_ph, id_ph)
            pii_total += hits
            if hits:
                stats.phi_documents.append(doc["name"])
        stats.pii_hits += pii_total
        for chunk in semantic_chunk(doc, params.get("chunk", {})):
            record = chunk.as_dict()
            record["recipe_version"] = str(recipe["metadata"]["version"])
            record["built_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            chunks.append(record)
    stats.chunks = len(chunks)
    stats.chunks_pass_quality = sum(1 for c in chunks if c["quality_score"] >= 1.0)

    git_commit = _git_commit(recipe_path)
    manifest = {
        "apiVersion": "data-os/v1",
        "kind": "AIDataProductArtifact",
        "metadata": {
            "name": spec["output"]["dataset"],
            "recipe": recipe["metadata"]["name"],
            "recipe_version": recipe["metadata"]["version"],
            "git_commit": git_commit,
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "spec": {
            "workload": spec["workload"]["type"],
            "source": {"dataset": spec["source"]["dataset"],
                       "documents": [d["name"] for d in unique]},
            "privacy": {"contains_phi": bool(stats.pii_hits), "deidentified": True},
            "lineage": {"recipe": recipe["metadata"]["name"], "git_commit": git_commit},
        },
    }
    quality = {
        "documents": {"input": stats.documents_in, "unique": stats.documents_unique,
                      "duplicates_dropped": stats.duplicates_dropped},
        "pii": {"hits": stats.pii_hits, "documents": sorted(set(stats.phi_documents))},
        "chunks": {"total": stats.chunks, "quality_pass": stats.chunks_pass_quality,
                   "length_min": min((len(c["content"]) for c in chunks), default=0),
                   "length_max": max((len(c["content"]) for c in chunks), default=0),
                   "length_avg": round(sum(len(c["content"]) for c in chunks) / len(chunks), 1) if chunks else 0},
    }
    return chunks, {"manifest": manifest, "quality": quality}, stats


def _git_commit(recipe_path: Path) -> str:
    try:
        result = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                                capture_output=True, text=True, timeout=5, check=True,
                                cwd=recipe_path.anchor if recipe_path.anchor else None)
        return result.stdout.strip()
    except Exception:
        return "unknown"


# ---------- 写出 ----------

def write_doris(chunks: list[dict], adapter, table: str) -> int:
    for chunk in chunks:
        adapter.query(
            f"INSERT INTO {table} (chunk_id, document_id, section, source_offset, content, "
            f"quality_score, recipe_version, built_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (chunk["chunk_id"], chunk["document_id"], chunk["section"], chunk["source_offset"],
             chunk["content"], chunk["quality_score"], chunk["recipe_version"], chunk["built_at"]))
    return len(chunks)


def next_version(s3_client, bucket: str, prefix: str) -> str:
    """版本不可覆盖：探测已存在版本并递增 patch 位。"""
    version = "v1.0.0"
    while True:
        try:
            s3_client.head_object(Bucket=bucket, Key=f"{prefix}/{version}/manifest.yaml")
            major, minor, patch = version[1:].split(".")
            version = f"v{major}.{minor}.{int(patch) + 1}"
        except s3_client.exceptions.ClientError:
            return version


def write_rustfs(s3_client, bucket: str, prefix: str, version: str,
                 chunks: list[dict], artifacts: dict) -> str:
    base = f"{prefix}/{version}"
    lines = "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in chunks)
    s3_client.put_object(Bucket=bucket, Key=f"{base}/data/chunks.jsonl", Body=lines.encode("utf-8"))
    s3_client.put_object(Bucket=bucket, Key=f"{base}/manifest.yaml",
                         Body=yaml.safe_dump(artifacts["manifest"], allow_unicode=True,
                                             sort_keys=False).encode("utf-8"))
    s3_client.put_object(Bucket=bucket, Key=f"{base}/quality.json",
                         Body=json.dumps(artifacts["quality"], ensure_ascii=False, indent=1).encode("utf-8"))
    return base


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rag-builder")
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--documents-dir", default=None, help="默认取 recipe 的 spec.source.dataset（仓库相对）")
    parser.add_argument("--skip-doris", action="store_true")
    parser.add_argument("--skip-rustfs", action="store_true")
    parser.add_argument("--bucket", default=None)
    parser.add_argument("--endpoint", default=None)
    args = parser.parse_args(argv)

    recipe_path = Path(args.recipe)
    documents_dir = Path(args.documents_dir) if args.documents_dir else recipe_path.parents[1] / \
        yaml.safe_load(recipe_path.read_text(encoding="utf-8"))["spec"]["source"]["dataset"]
    chunks, artifacts, stats = build(recipe_path, documents_dir)
    print(json.dumps(artifacts["quality"], ensure_ascii=False, indent=1))

    recipe = yaml.safe_load(recipe_path.read_text(encoding="utf-8"))
    output = recipe["spec"]["output"]
    prefix = output.get("object_prefix", "ai-data/medical-rag-guideline")

    if not args.skip_doris:
        from adapters import DorisAdapter
        from settings import settings
        written = write_doris(chunks, DorisAdapter(settings), output["doris_table"])
        print(f"doris chunks written: {written}")
    if not args.skip_rustfs:
        import boto3
        from settings import settings
        endpoint = args.endpoint or getattr(settings, "rustfs_endpoint", "http://rustfs:9000")
        s3 = boto3.client("s3", endpoint_url=endpoint,
                          aws_access_key_id=os.environ.get("DATAOS_RUSTFS_ACCESS_KEY", ""),
                          aws_secret_access_key=os.environ.get("DATAOS_RUSTFS_SECRET_KEY", ""),
                          region_name="us-east-1")
        bucket = args.bucket or os.environ.get("DATAOS_AI_BUCKET", "dataos-ai-data")
        version = next_version(s3, bucket, prefix)
        base = write_rustfs(s3, bucket, prefix, version, chunks, artifacts)
        print(f"rustfs artifact: s3://{bucket}/{base} (version {version})")
    print(f"build complete: {stats.chunks} chunks from {stats.documents_unique} documents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
