"""ToB 查询 API：X-API-Key 认证（经控制面 registry 缓存匹配 hash），
目录 / 契约 / 参数化查询三端点；G26 增 internal verified-queries 面
（资源侧服务身份，复用同一执行器与审计出口）。错误契约统一 code+message；
鉴权调决与审计出口收敛在 CallSession（session.py，S9 收敛）。
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Response, status
from pydantic import BaseModel, Field

from controlplane import ControlPlaneClient, sha256_hex
from breaker import DorisBreaker
from executor import ParameterError, enforce_hospital_scope, execute, parameters_json_of, validate_parameters
from exports import ExportExpired, ExportManager, ExportNotFound, ExportNotReady
from ratelimit import SlidingWindowLimiter
from resource_auth import ResourceAuth, ResourceAuthError, ResourceAuthNotConfigured
from session import CallSession, ScopeInvalid

router = APIRouter()

_control_plane: ControlPlaneClient | None = None
_settings: Any = None
_exports: ExportManager | None = None
_breaker = DorisBreaker()
_resource_auth: ResourceAuth | None = None
_verified_rate = SlidingWindowLimiter(30)


def bind(control_plane: ControlPlaneClient, settings: Any) -> None:
    global _control_plane, _settings
    _control_plane = control_plane
    _settings = settings


def bind_exports(exports: ExportManager) -> None:
    global _exports
    _exports = exports


def bind_breaker(breaker: DorisBreaker) -> None:
    global _breaker
    _breaker = breaker


def bind_resource_auth(auth: ResourceAuth | None, limiter: SlidingWindowLimiter | None = None) -> None:
    """main 装配与测试注入共用；auth=None 表示未配置（internal 面 fail-closed）。"""
    global _resource_auth, _verified_rate
    _resource_auth = auth
    if limiter is not None:
        _verified_rate = limiter


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
    if not _breaker.allow():
        session.report(status.HTTP_503_SERVICE_UNAVAILABLE)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "DORIS_CIRCUIT_OPEN",
                                    "message": "查询引擎熔断保护中，请稍后重试"})
    try:
        result = execute(str(service["sqlTemplate"]), values, service, _settings)
    except Exception:  # noqa: BLE001  Doris 不可达/超时统一 503，不泄漏内部细节
        _breaker.record_failure()
        session.report(status.HTTP_503_SERVICE_UNAVAILABLE)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "DORIS_UNAVAILABLE", "message": "查询引擎暂不可用"}) from None
    _breaker.record_success()
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


@router.post("/v1/services/{code}/export", status_code=status.HTTP_202_ACCEPTED)
def create_export(code: str, request: QueryRequest,
                  x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """大结果集异步导出（P7）：同步校验（鉴权/参数/医院范围/配额）后
    创建任务并后台执行；轮询 /v1/exports/{id}，完成后经 download 取产物。"""
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
    export_id = _exports.submit(code, session.key, request.parameters, values)
    return {"exportId": export_id, "status": "PENDING"}


@router.get("/v1/exports/{export_id}")
def export_status(export_id: str, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """任务状态（仅创建 Key 可见；不烧配额——产物交付不属于新调用）。"""
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    projection = _exports.status(export_id, session.key_hash)
    if projection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "EXPORT_NOT_FOUND", "message": "导出任务不存在"})
    return projection


@router.get("/v1/exports/{export_id}/download")
def export_download(export_id: str, x_api_key: str | None = Header(default=None)) -> Response:
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    try:
        filename, content = _exports.download(export_id, session.key_hash)
    except ExportNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "EXPORT_NOT_FOUND", "message": "导出任务不存在"}) from None
    except ExportExpired:
        raise HTTPException(status_code=status.HTTP_410_GONE,
                            detail={"code": "EXPORT_EXPIRED", "message": "导出产物已过保留期"}) from None
    except ExportNotReady as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail={"code": "EXPORT_NOT_READY",
                                    "message": f"导出任务未完成（当前状态 {exc.status}）"}) from None
    return Response(content=content, media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---- 调用方自助面（P8 余项）：全部凭 X-API-Key，鉴权与吊销照查，不烧配额 ----

@router.get("/v1/me")
def me(x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """调用方画像：绑定服务契约（版本/限额，含已下线契约展示）+ 当日配额用量。"""
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    key = session.key
    service = _control_plane.find_contract(str(key.get("serviceCode", "")))
    if service is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "SERVICE_NOT_FOUND", "message": "绑定服务不存在或未发布"})
    return {
        "callerName": key.get("callerName", ""),
        "service": _summary_of(service),
        "serviceStatus": str(key.get("serviceStatus", "PUBLISHED")),
        "dailyQuota": int(key.get("dailyQuota", 0)),
        "usedToday": int(key.get("usedToday", 0)),
    }


@router.get("/v1/usage/calls")
def usage_calls(limit: int = 20, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """本人近期调用审计（query/export 分类可见）。"""
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    items = _control_plane.key_calls(session.key_hash, min(max(limit, 1), 100))
    return {"items": items, "total": len(items)}


@router.get("/v1/contract-events")
def contract_events(limit: int = 50, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """合同事件轮询通道：本人服务最近的变更事实（含 diff 与 TEST）；调用方按 eventId 幂等消费。"""
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    items = _control_plane.contract_events(session.key_hash, min(max(limit, 1), 100))
    return {"items": items, "total": len(items)}


class SubscriptionRequest(BaseModel):
    webhookUrl: str
    webhookSecret: str | None = None


@router.post("/v1/subscriptions", status_code=status.HTTP_201_CREATED)
def create_subscription(request: SubscriptionRequest,
                        x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """订阅合同变更通知：HMAC 签名 webhook 推送（secret 只回显一次）。"""
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    try:
        issued = _control_plane.create_subscription(session.key_hash, request.webhookUrl,
                                                    request.webhookSecret)
    except Exception as exc:  # noqa: BLE001  控制面校验失败（URL/secret）转 400/503
        detail = getattr(exc, "response", None)
        if detail is not None and detail.status_code == 400:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail={"code": "SUBSCRIPTION_INVALID",
                                        "message": "webhookUrl 或 webhookSecret 不合法（HTTPS/长度 ≥ 32）"}) from exc
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "UPSTREAM_UNAVAILABLE", "message": "服务注册表暂不可用"}) from exc
    return issued


@router.get("/v1/subscriptions")
def subscriptions(x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    items = _control_plane.subscriptions(session.key_hash)
    return {"items": items, "total": len(items)}


@router.delete("/v1/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_subscription(subscription_id: str, x_api_key: str | None = Header(default=None)) -> Response:
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    if not _control_plane.delete_subscription(subscription_id, session.key_hash):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "SUBSCRIPTION_NOT_FOUND", "message": "订阅不存在"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/v1/subscriptions/{subscription_id}/test")
def test_subscription(subscription_id: str, x_api_key: str | None = Header(default=None)) -> dict[str, Any]:
    """触发 TEST 事件：调用方全链路验证接收端验签实现（事件也进轮询通道）。"""
    session = CallSession.open(_control_plane, x_api_key, None, audit=False, enforce_quota=False)
    result = _control_plane.test_subscription(subscription_id, session.key_hash)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "SUBSCRIPTION_NOT_FOUND", "message": "订阅不存在"})
    return result


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


# ---- G26 受控智能问数：internal verified-queries 面 ----
# 认证方向与 public 面相反：服务身份 JWT（audience=dataos-data-api）而非
# X-API-Key；机构范围以调用方用户机构为授权集合；执行/熔断/审计复用既有
# 执行器与 report_call（kind=verified_query，key 归属为空）。

class VerifiedQueryRequest(BaseModel):
    parameters: dict[str, Any] = Field(default_factory=dict)
    context: dict[str, Any] = Field(default_factory=dict)


def _audit_verified(service_code: str, parameters: dict[str, Any], status_code: int,
                    *, row_count: int = 0, truncated: bool = False, elapsed_ms: int = 0) -> None:
    """问数面调用审计（服务未知时控制面自然丢弃，与 public 面口径一致）。"""
    _control_plane.report_call(service_code, "", parameters_json_of(parameters),
                               row_count, truncated, elapsed_ms, status_code,
                               kind="verified_query")


@router.post("/internal/v1/verified-queries/{service_code}/query")
def verified_query(service_code: str, request: VerifiedQueryRequest,
                   authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if _resource_auth is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "RESOURCE_AUTH_NOT_CONFIGURED",
                                    "message": "资源侧服务身份未配置"
                                               "（DATA_API_RESOURCE_ISSUER/AUDIENCE/JWKS_URI）"})
    try:
        claims = _resource_auth.validate(authorization)
    except ResourceAuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail={"code": "AUTH_REJECTED", "message": str(exc)}) from exc
    del claims  # claims 不进日志/响应（最小持有）
    if not _verified_rate.allow(service_code):
        _audit_verified(service_code, request.parameters, status.HTTP_429_TOO_MANY_REQUESTS)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail={"code": "VERIFIED_QUERY_RATE_LIMITED",
                                    "message": "问数执行面限流中，请稍后重试"})
    try:
        registry = _control_plane.registry()
    except Exception:  # noqa: BLE001  registry 不可达（含超窗 stale-grace）统一 503
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "REGISTRY_UNAVAILABLE",
                                    "message": "服务注册面暂不可用"}) from None
    service = next((item for item in registry.get("services", [])
                    if item.get("code") == service_code), None)
    if service is None:
        deprecated = any(item.get("code") == service_code
                         for item in registry.get("deprecatedServices", []))
        _audit_verified(service_code, request.parameters, status.HTTP_404_NOT_FOUND)
        message = "服务已下线（DEPRECATED）: " + service_code if deprecated \
            else "服务不存在或未发布: " + service_code
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "SERVICE_NOT_PUBLISHED", "message": message})
    try:
        contracts = json.loads(service.get("parameters") or "[]")
    except ValueError:
        contracts = []
    institution = str(request.context.get("institutionId") or "")
    try:
        values = validate_parameters(contracts, request.parameters)
        # 机构范围：调用方用户机构即授权集合（空机构身份只能跑无 hospital_code 参数的服务）
        enforce_hospital_scope(values, contracts, [institution] if institution else [])
    except ScopeInvalid as exc:
        _audit_verified(service_code, request.parameters, status.HTTP_403_FORBIDDEN)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "HOSPITAL_SCOPE_INVALID", "message": str(exc)}) from exc
    except ParameterError as exc:
        _audit_verified(service_code, request.parameters, status.HTTP_400_BAD_REQUEST)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail={"code": "PARAM_INVALID", "message": str(exc)}) from exc
    except PermissionError as exc:
        _audit_verified(service_code, request.parameters, status.HTTP_403_FORBIDDEN)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail={"code": "HOSPITAL_NOT_AUTHORIZED", "message": str(exc)}) from exc
    if not _breaker.allow():
        _audit_verified(service_code, request.parameters, status.HTTP_503_SERVICE_UNAVAILABLE)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "DORIS_CIRCUIT_OPEN",
                                    "message": "查询引擎熔断保护中，请稍后重试"})
    try:
        result = execute(str(service["sqlTemplate"]), values, service, _settings)
    except Exception:  # noqa: BLE001  Doris 不可达/超时统一 503，不泄漏内部细节
        _breaker.record_failure()
        _audit_verified(service_code, request.parameters, status.HTTP_503_SERVICE_UNAVAILABLE)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"code": "DORIS_UNAVAILABLE", "message": "查询引擎暂不可用"}) from None
    _breaker.record_success()
    _audit_verified(service_code, request.parameters, status.HTTP_200_OK,
                    row_count=result["rowCount"], truncated=result["truncated"],
                    elapsed_ms=result["elapsedMs"])
    return {
        "service": service_code,
        "version": service.get("version", ""),
        "columns": result["columns"],
        "rows": result["rows"],
        "rowCount": result["rowCount"],
        "truncated": result["truncated"],
        "elapsedMs": result["elapsedMs"],
    }
