"""CallSession：一次 data-api 调用的鉴权调决与审计出口的单一属主。

调决链：X-API-Key → registry 匹配（不可达收口 503 REGISTRY_UNAVAILABLE）
→ 服务绑定 → 日配额；医院行级授权解析 fail-closed——坏配置拒绝执行，
不再静默回退全院放行（S9 收敛）。

审计口径：query 全部结局（含 401 坏 Key / 403 绑定 / 429 配额 / 503）经
唯一出口 report 回写；「未携带 Key」的匿名探测不审计（无身份素材，纯扫描
噪声）；catalog/schema 元数据读不审计，但鉴权与配额照走。
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, status

from controlplane import sha256_hex


class ScopeInvalid(PermissionError):
    """Key 的医院授权配置损坏（坏 JSON / 非数组）——fail-closed 拒绝。"""


class CallSession:
    """经 open() 构造；持有 registry 匹配出的 Key 投影与本次调用上下文。"""

    def __init__(self, control_plane: Any, key: dict[str, Any], service_code: str | None,
                 parameters_json: str, audit: bool):
        self._control_plane = control_plane
        self._key = key
        self._parameters_json = parameters_json
        self._audit_enabled = audit
        self.service_code = service_code if service_code is not None else str(key.get("serviceCode", ""))

    @classmethod
    def open(cls, control_plane: Any, x_api_key: str | None, service_code: str | None,
             parameters_json: str = "", *, audit: bool = True,
             enforce_quota: bool = True) -> "CallSession":
        """鉴权调决入口；audit=True 时失败结局同样经审计出口；
        enforce_quota=False 供导出状态/下载面（鉴权与吊销照查，不烧配额）。"""
        if not x_api_key:
            # 匿名探测：401 但不审计（无身份素材）
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail={"code": "API_KEY_REQUIRED", "message": "缺少 X-API-Key"})
        key_hash = sha256_hex(x_api_key)
        try:
            key = cls._resolve(control_plane, key_hash, service_code, enforce_quota)
        except HTTPException as exc:
            if audit:
                _safe_report(control_plane, service_code or "", key_hash, parameters_json,
                             exc.status_code)
            raise
        return cls(control_plane, key, service_code, parameters_json, audit)

    @staticmethod
    def _resolve(control_plane: Any, key_hash: str, service_code: str | None,
                 enforce_quota: bool = True) -> dict[str, Any]:
        try:
            key = control_plane.find_key(key_hash)
        except Exception as exc:  # registry 拉取失败：收口 503，不向调用方泄漏内部细节
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                detail={"code": "REGISTRY_UNAVAILABLE",
                                        "message": "服务注册表暂不可用"}) from exc
        if key is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail={"code": "API_KEY_INVALID", "message": "API Key 无效或已吊销"})
        if service_code is not None and key.get("serviceCode") != service_code:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail={"code": "SERVICE_NOT_AUTHORIZED",
                                        "message": f"该 Key 未授权服务 {service_code}"})
        if enforce_quota and int(key.get("usedToday", 0)) >= int(key.get("dailyQuota", 1)):
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                                detail={"code": "QUOTA_EXCEEDED",
                                        "message": f"已达当日配额 {key.get('dailyQuota')} 次"})
        return key

    @property
    def key(self) -> dict[str, Any]:
        return self._key

    @property
    def key_hash(self) -> str:
        return str(self._key.get("keyHash", ""))

    def hospitals(self) -> list[str]:
        """Key 的医院授权集合。未配置视为 ['*']（与控制面发放语义对齐）；
        配置损坏抛 ScopeInvalid——fail-closed，绝不静默全院放行。"""
        raw = self._key.get("allowedHospitals")
        if raw is None or raw == "":
            return ["*"]
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except ValueError as exc:
                raise ScopeInvalid("Key 的医院授权配置损坏（坏 JSON），已拒绝执行") from exc
        if not isinstance(raw, list):
            raise ScopeInvalid("Key 的医院授权配置损坏（非数组），已拒绝执行")
        return [str(item) for item in raw]

    def require_service(self) -> dict[str, Any]:
        """解析已绑定/已发布服务；404 与 503 结局同样走审计出口。"""
        try:
            service = self._control_plane.find_service(self.service_code)
        except Exception as exc:
            self.report(status.HTTP_503_SERVICE_UNAVAILABLE)
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                                detail={"code": "REGISTRY_UNAVAILABLE",
                                        "message": "服务注册表暂不可用"}) from exc
        if service is None:
            self.report(status.HTTP_404_NOT_FOUND)
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                detail={"code": "SERVICE_NOT_FOUND",
                                        "message": f"服务不存在或未发布: {self.service_code}"})
        return service

    def report(self, status_code: int, *, row_count: int = 0, truncated: bool = False,
               elapsed_ms: int = 0) -> None:
        """唯一审计出口：一次调用至多一条，落在其最终结局上。"""
        if not self._audit_enabled:
            return
        self._control_plane.report_call(self.service_code, str(self._key.get("keyHash", "")),
                                        self._parameters_json, row_count, truncated,
                                        elapsed_ms, status_code)


def _safe_report(control_plane: Any, code: str, key_hash: str, parameters_json: str,
                 status_code: int) -> None:
    """open() 失败路径的审计：report_call 自身尽力而为，不再向上抛。"""
    try:
        control_plane.report_call(code, key_hash, parameters_json, 0, False, 0, status_code)
    except Exception:  # noqa: BLE001  审计失败不改变调用方已定的失败结局
        pass
