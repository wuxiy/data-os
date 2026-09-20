"""HTTP API：POST /assess、GET /readiness、POST /evaluate、POST /build（最近评估由
control-plane 持久化，本服务无库；/readiness 以同参数重执行返回当前口径，幂等）。
"""
from __future__ import annotations

import os
from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field

from catalog import CatalogError
from engine import Engine
from evaluation import evaluate_corpus
from adapters import DorisAdapter
from settings import Settings, settings
from security import Authenticator

router = APIRouter()

_engine: Engine | None = None
_authenticator: Authenticator | None = None


def bind(engine: Engine, authenticator: Authenticator) -> None:
    global _engine, _authenticator
    _engine = engine
    _authenticator = authenticator


class AssessRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product: str = Field(min_length=1)
    version: str = Field(default="v0.1.0")
    # profile 必填无缺省：词汇表唯一源是声明仓库 profiles/，未知值由引擎拒绝。
    profile: str = Field(min_length=1)
    # 控制面 build 链路随请求发送的 recipe 关联（G9 契约）。显式收下留档，
    # 不再被 pydantic 静默丢弃；构建与版本登记在 rag_builder / 控制面侧完成。
    # （G21-4 起评估经 manifest_probe 消费 product@version 的产物清单事实。）
    recipe_ref: str = Field(default="", alias="recipeRef")


@router.post("/assess")
def assess(request: AssessRequest, authorization: str | None = Header(default=None)) -> dict:
    _authenticator.require(authorization)
    try:
        report = _engine.assess(request.product, request.version, request.profile)
    except CatalogError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return report.model_dump(by_alias=True)


class EvaluateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product: str = Field(min_length=1)
    version: str = Field(default="v0.1.0")
    # 双产品契约（G17）：控制面传当前版本登记的 recipeRef，引擎按 Recipe 的
    # spec.output 解析语料表与评测集；缺省/解析失败回落单产品时代默认。
    recipeRef: str = Field(default="")


def _recipe_path(recipe_ref: str) -> Path | None:
    """recipeRef → ai-data/recipes/{name}.yaml；未找到返回 None（调用方决定回落或 404）。"""
    if not recipe_ref:
        return None
    name = recipe_ref.strip().removesuffix(".yaml").split("/")[-1].split("@")[0]
    path = Path(os.environ.get("AI_DATA_DIR", "/opt/dataos/ai-data")) / "recipes" / f"{name}.yaml"
    return path if path.is_file() else None


def _corpus_paths(recipe_ref: str) -> tuple[str, Path]:
    """recipeRef → (语料表, 评测集路径)；recipe 未声明或文件不存在时回落默认。"""
    ai_data_dir = Path(os.environ.get("AI_DATA_DIR", "/opt/dataos/ai-data"))
    table = "dataos_ai.chunks"
    eval_file = ai_data_dir / "eval" / "medical-rag-evalset.jsonl"
    recipe_path = _recipe_path(recipe_ref)
    if recipe_path is not None:
        output = (yaml.safe_load(recipe_path.read_text(encoding="utf-8"))
                  .get("spec", {}).get("output", {}))
        table = output.get("doris_table", table)
        if output.get("eval_file"):
            eval_file = ai_data_dir / output["eval_file"]
    return table, eval_file


@router.post("/evaluate")
def evaluate(request: EvaluateRequest, authorization: str | None = Header(default=None)) -> dict:
    _authenticator.require(authorization)
    table, eval_file = _corpus_paths(request.recipeRef)
    # ORDER BY 保证 BM25 同分并列破平的确定性（G17 实测：无序时 MRR 有 ±0.01 抖动）
    rows = DorisAdapter(settings).query(
        f"SELECT chunk_id, document_id, section, content FROM {table} ORDER BY chunk_id", ())
    chunks = [
        {"chunk_id": row[0], "document_id": row[1], "section": row[2] or "", "content": row[3]}
        for row in rows
    ]
    report = evaluate_corpus(chunks, eval_file)
    report = {"product": request.product, "version": request.version, **report}
    return report


class BuildRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product: str = Field(min_length=1)
    version: str = Field(default="v0.1.0")
    recipeRef: str = Field(min_length=1)


def _writer_settings() -> Settings:
    """构建写入面：专用 writer 账号（仅 dataos_ai 库写权），与评估只读面分离。"""
    return Settings(**{**settings.__dict__,
                       "doris_user": settings.doris_writer_user,
                       "doris_password": settings.doris_writer_password})


def _rustfs_client():
    from adapters import rustfs_client
    return rustfs_client(settings)


@router.post("/build")
def build_artifact(request: BuildRequest, authorization: str | None = Header(default=None)) -> dict:
    """构建执行面（G18）：按 Recipe 真实执行 rag_builder 全链并双落产物。

    output.reset_before_write=true 时写前清空产物表（单产品表防陈旧行滞留；
    SERVING 中的合成语料表不开此开关，维持覆盖写）。
    """
    import rag_builder as rb

    _authenticator.require(authorization)
    recipe_path = _recipe_path(request.recipeRef)
    if recipe_path is None:
        raise HTTPException(status_code=404, detail=f"Recipe 未找到：{request.recipeRef}")
    recipe = yaml.safe_load(recipe_path.read_text(encoding="utf-8"))
    spec = recipe["spec"]
    source = spec.get("source", {})
    output = spec["output"]

    if source.get("kind") == "doris_table":
        chunks, artifacts, stats = rb.build(recipe_path, None, adapter=DorisAdapter(settings))
    else:
        # spec.source.dataset 按仓库根相对口径书写（"ai-data/documents"——CLI 以
        # recipe.parents[1] 解析）；服务侧映射到 AI_DATA_DIR（其即 ai-data 目录）
        dataset = str(source["dataset"])
        if dataset.startswith("ai-data/"):
            dataset = dataset[len("ai-data/"):]
        documents_dir = Path(os.environ.get("AI_DATA_DIR", "/opt/dataos/ai-data")) / dataset
        chunks, artifacts, stats = rb.build(recipe_path, documents_dir)

    writer = DorisAdapter(_writer_settings())
    table = output["doris_table"]
    reset = bool(output.get("reset_before_write"))
    if reset:
        writer.query(f"DELETE FROM {table}", ())
    written = rb.write_doris(chunks, writer, table)

    s3 = _rustfs_client()
    bucket = os.environ.get("DATAOS_AI_BUCKET", "dataos-ai-data")
    prefix = output.get("object_prefix", "ai-data/medical-rag-guideline")
    try:
        s3.head_bucket(Bucket=bucket)
    except Exception:
        s3.create_bucket(Bucket=bucket)
    version = rb.next_version(s3, bucket, prefix)
    rb.write_rustfs(s3, bucket, prefix, version, chunks, artifacts)

    return {
        "product": request.product,
        "version": request.version,
        "recipe": recipe["metadata"]["name"],
        "recipe_version": str(recipe["metadata"]["version"]),
        "chunks": stats.chunks,
        "documents": {"input": stats.documents_in, "unique": stats.documents_unique,
                      "duplicates_dropped": stats.duplicates_dropped},
        "doris": {"table": table, "written": written, "reset": reset},
        "rustfs": {"bucket": bucket, "prefix": prefix, "version": version},
        "quality": artifacts["quality"],
    }


@router.get("/readiness")
def readiness(product: str, version: str = "v0.1.0",
              profile: str = Query(min_length=1),
              authorization: str | None = Header(default=None)) -> dict:
    _authenticator.require(authorization)
    try:
        report = _engine.assess(product, version, profile)
    except CatalogError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return report.model_dump(by_alias=True)
