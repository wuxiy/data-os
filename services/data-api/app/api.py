"""ToB 查询 API：X-API-Key 认证（经控制面 registry 缓存匹配 hash），
目录 / 契约 / 参数化查询三端点。错误契约统一 code+message；
鉴权调决与审计出口收敛在 CallSession（session.py，S9 收敛）。
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from controlplane import ControlPlaneClient
from executor import ParameterError, enforce_hospital_scope, execute, parameters_json_of, validate_parameters
from session import CallSession, ScopeInvalid

router = APIRouter()

_control_plane: ControlPlaneClient | None = None
_settings: Any = None


def bind(control_plane: ControlPlaneClient, settings: Any) -> None:
    global _control_plane, _settings
    _control_plane = control_plane
    _settings = settings


class QueryRequest(BaseModel):
    parameters: dict[str, Any] = Field(default_factory=dict)


@router.get("/v1/services")
def catalog(x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """调用方目录：绑定服务取自 Key 本身；元数据读不审计，鉴权与配额照走。"""
    session = CallSession.open(_control_plane, x_api_key, None, audit=False)
    service = session.require_service()
    return {"items": [_summary_of(service)], "total": 1}


@router.get("/v1/services/{code}/schema")
def schema(code: str, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    session = CallSession.open(_control_plane, x_api_key, code, audit=False)
    return _summary_of(session.require_service())


@router.post("/v1/services/{code}/query")
def query(code: str, request: QueryRequest, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    session = CallSession.open(_control_plane, x_api_key, code,
                               parameters_json_of(request.parameters))
    service = session.require_service()
    try:
        contracts = json.loads(service.get("parameters") or "[]")
    except ValueError:
        contracts = []
    try:
        values = validate_parameters(contracts, request.parameters)
        enforce_hospital_scope(values, contracts, session.hospitals())
    except ScopeInvalid as exc:
        session.report(status.HTTP_403_FORBIDDEN)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "HOSPITAL_SCOPE_INVALID", "message": str(exc)}) from exc
    except ParameterError as exc:
        session.report(status.HTTP_400_BAD_REQUEST)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail={"code": "PARAM_INVALID", "message": str(exc)}) from exc
    except PermissionError as exc:
        session.report(status.HTTP_403_FORBIDDEN)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "HOSPITAL_NOT_AUTHORIZED", "message": str(exc)}) from exc
    try:
        result = execute(str(service["sqlTemplate"]), values, service, _settings)
    except Exception:  # noqa: BLE001  Doris 不可达/超时统一 503，不泄漏内部细节
        session.report(status.HTTP_503_SERVICE_UNAVAILABLE)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "DORIS_UNAVAILABLE", "message": "查询引擎暂不可用"}) from None
    session.report(status.HTTP_200_OK, row_count=result["rowCount"],
                   truncated=result["truncated"], elapsed_ms=result["elapsedMs"])
    return {
        "service": code,
        "version": service.get("version", ""),
        "columns": result["columns"],
        "rows": result["rows"],
        "rowCount": result["rowCount"],
        "truncated": result["truncated"],
        "elapsedMs": result["elapsedMs"],
    }


def _summary_of(service: dict[str, Any]) -> dict[str, Any]:
    """对外目录/契约视图：不出 SQL 模板。"""
    def parse(name: str) -> list[Any]:
        raw = service.get(name) or "[]"
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return []

    return {
        "code": service.get("code", ""),
        "name": service.get("name", ""),
        "description": service.get("description", ""),
        "version": service.get("version", ""),
        "parameters": parse("parameters"),
        "columns": parse("columns"),
        "maxRows": service.get("maxRows", 1000),
        "timeoutSeconds": service.get("timeoutSeconds", 30),
    }
