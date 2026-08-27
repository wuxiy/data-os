"""ToB 查询 API：X-API-Key 认证（经控制面 registry 缓存匹配 hash），
目录 / 契约 / 参数化查询三端点。错误契约统一 code+message。
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from controlplane import ControlPlaneClient, sha256_hex
from executor import ParameterError, enforce_hospital_scope, execute, parameters_json_of, validate_parameters

router = APIRouter()

_control_plane: ControlPlaneClient | None = None
_settings: Any = None


def bind(control_plane: ControlPlaneClient, settings: Any) -> None:
    global _control_plane, _settings
    _control_plane = control_plane
    _settings = settings


class QueryRequest(BaseModel):
    parameters: dict[str, str] = Field(default_factory=dict)


class Context:
    """一次调用的 Key 上下文（registry 匹配产物）。"""

    def __init__(self, key: dict[str, Any]):
        self.key = key


def _require_key(x_api_key: str | None, service_code: str) -> Context:
    if not x_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "API_KEY_REQUIRED", "message": "缺少 X-API-Key"})
    key = _control_plane.find_key(sha256_hex(x_api_key))
    if key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "API_KEY_INVALID", "message": "API Key 无效或已吊销"})
    if key.get("serviceCode") != service_code:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "SERVICE_NOT_AUTHORIZED",
                                    "message": f"该 Key 未授权服务 {service_code}"})
    if int(key.get("usedToday", 0)) >= int(key.get("dailyQuota", 1)):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail={"code": "QUOTA_EXCEEDED",
                                    "message": f"已达当日配额 {key.get('dailyQuota')} 次"})
    return Context(key)


def _require_service(code: str) -> dict[str, Any]:
    service = _control_plane.find_service(code)
    if service is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "SERVICE_NOT_FOUND", "message": f"服务不存在或未发布: {code}"})
    return service


def _hospitals_of(key: dict[str, Any]) -> list[str]:
    raw = key.get("allowedHospitals") or '["*"]'
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = ["*"]
    return [str(item) for item in raw]


@router.get("/v1/services")
def catalog(x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    if not x_api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "API_KEY_REQUIRED", "message": "缺少 X-API-Key"})
    key = _control_plane.find_key(sha256_hex(x_api_key))
    if key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "API_KEY_INVALID", "message": "API Key 无效或已吊销"})
    code = key.get("serviceCode")
    service = _control_plane.find_service(code)
    if service is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "SERVICE_NOT_FOUND", "message": f"绑定服务未发布: {code}"})
    return {"items": [_summary_of(service)], "total": 1}


@router.get("/v1/services/{code}/schema")
def schema(code: str, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    _require_key(x_api_key, code)
    service = _require_service(code)
    return _summary_of(service)


@router.post("/v1/services/{code}/query")
def query(code: str, request: QueryRequest, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    context = _require_key(x_api_key, code)
    service = _require_service(code)
    try:
        contracts = json.loads(service.get("parameters") or "[]")
    except ValueError:
        contracts = []
    try:
        values = validate_parameters(contracts, request.parameters)
        enforce_hospital_scope(values, contracts, _hospitals_of(context.key))
    except ParameterError as exc:
        _control_plane.report_call(code, context.key.get("keyHash", ""),
                                   parameters_json_of(request.parameters), 0, False, 0, 400)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail={"code": "PARAM_INVALID", "message": str(exc)}) from exc
    except PermissionError as exc:
        _control_plane.report_call(code, context.key.get("keyHash", ""),
                                   parameters_json_of(request.parameters), 0, False, 0, 403)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "HOSPITAL_NOT_AUTHORIZED", "message": str(exc)}) from exc
    try:
        result = execute(str(service["sqlTemplate"]), values, service, _settings)
    except Exception:  # noqa: BLE001  Doris 不可达/超时统一 503，不泄漏内部细节
        _control_plane.report_call(code, context.key.get("keyHash", ""),
                                   parameters_json_of(request.parameters), 0, False, 0, 503)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "DORIS_UNAVAILABLE", "message": "查询引擎暂不可用"}) from None
    _control_plane.report_call(code, context.key.get("keyHash", ""),
                               parameters_json_of(request.parameters),
                               result["rowCount"], result["truncated"], result["elapsedMs"], 200)
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
