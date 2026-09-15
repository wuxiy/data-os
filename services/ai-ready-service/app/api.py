"""HTTP API：POST /assess、GET /readiness、POST /evaluate（最近评估由
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
from settings import settings
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
    # 不再被 pydantic 静默丢弃；当前评估不消费——构建与版本登记在
    # rag_builder / 控制面侧完成。
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


def _corpus_paths(recipe_ref: str) -> tuple[str, Path]:
    """recipeRef → (语料表, 评测集路径)；recipe 未声明或文件不存在时回落默认。"""
    ai_data_dir = Path(os.environ.get("AI_DATA_DIR", "/opt/dataos/ai-data"))
    table = "dataos_ai.chunks"
    eval_file = ai_data_dir / "eval" / "medical-rag-evalset.jsonl"
    if recipe_ref:
        name = recipe_ref.strip().removesuffix(".yaml").split("/")[-1].split("@")[0]
        recipe_path = ai_data_dir / "recipes" / f"{name}.yaml"
        if recipe_path.is_file():
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
