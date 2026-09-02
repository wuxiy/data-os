"""HTTP API：POST /assess、GET /readiness（最近评估由 control-plane 持久化，
本服务无库；/readiness 以同参数重执行返回当前口径，幂等）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

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
    product: str = Field(min_length=1)
    version: str = Field(default="v0.1.0")
    # profile 必填无缺省：词汇表唯一源是声明仓库 profiles/，未知值由引擎拒绝。
    profile: str = Field(min_length=1)


@router.post("/assess")
def assess(request: AssessRequest, authorization: str | None = Header(default=None)) -> dict:
    _authenticator.require(authorization)
    try:
        report = _engine.assess(request.product, request.version, request.profile)
    except CatalogError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return report.model_dump(by_alias=True)


class EvaluateRequest(BaseModel):
    product: str = Field(min_length=1)
    version: str = Field(default="v0.1.0")


@router.post("/evaluate")
def evaluate(request: EvaluateRequest, authorization: str | None = Header(default=None)) -> dict:
    _authenticator.require(authorization)
    rows = DorisAdapter(settings).query(
        "SELECT chunk_id, document_id, section, content FROM dataos_ai.chunks", ())
    chunks = [
        {"chunk_id": row[0], "document_id": row[1], "section": row[2] or "", "content": row[3]}
        for row in rows
    ]
    report = evaluate_corpus(chunks, __import__("pathlib").Path(
        __import__("os").environ.get("AI_DATA_DIR", "/opt/dataos/ai-data")) / "eval/medical-rag-evalset.jsonl")
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
