"""HTTP API：POST /assess、GET /readiness（最近评估由 control-plane 持久化，
本服务无库；/readiness 以同参数重执行返回当前口径，幂等）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from engine import Engine
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
    profile: str = Field(default="medical-rag")


@router.post("/assess")
def assess(request: AssessRequest, authorization: str | None = Header(default=None)) -> dict:
    _authenticator.require(authorization)
    report = _engine.assess(request.product, request.version, request.profile)
    return report.model_dump()


@router.get("/readiness")
def readiness(product: str, version: str = "v0.1.0", profile: str = "medical-rag",
              authorization: str | None = Header(default=None)) -> dict:
    _authenticator.require(authorization)
    report = _engine.assess(product, version, profile)
    return report.model_dump()
