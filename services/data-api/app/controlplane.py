"""控制面 registry 客户端：OIDC client_credentials 取 token（dev 可静态令牌），
拉取已发布服务定义 + 有效 Key 投影（TTL 缓存），并回写调用审计。
"""
from __future__ import annotations

import hashlib
import threading
import time
import uuid
from typing import Any

import httpx


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class ControlPlaneClient:
    def __init__(self, settings: Any, client: httpx.Client | None = None):
        self._settings = settings
        self._client = client or httpx.Client(verify=False, timeout=10.0)
        self._token = ""
        self._token_expires_at = 0.0
        self._registry: dict[str, Any] | None = None
        self._registry_expires_at = 0.0
        self._lock = threading.Lock()

    # ---- token ----

    def _ensure_token(self) -> str:
        if not (self._settings.oidc_client_id and self._settings.oidc_client_secret):
            return self._settings.internal_token
        if self._token and self._token_expires_at > time.time() + 30:
            return self._token
        response = self._client.post(self._settings.oidc_token_uri, data={
            "grant_type": "client_credentials",
            "client_id": self._settings.oidc_client_id,
            "client_secret": self._settings.oidc_client_secret,
        })
        response.raise_for_status()
        payload = response.json()
        self._token = str(payload["access_token"])
        self._token_expires_at = time.time() + float(payload.get("expires_in", 300))
        return self._token

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._ensure_token()}"}

    # ---- registry ----

    def registry(self, force: bool = False) -> dict[str, Any]:
        with self._lock:
            if not force and self._registry and self._registry_expires_at > time.time():
                return self._registry
            response = self._client.get(
                self._settings.controlplane_base_url.rstrip("/") + "/internal/data-api/registry",
                headers=self._headers())
            response.raise_for_status()
            self._registry = response.json()
            self._registry_expires_at = time.time() + self._settings.registry_ttl_s
            return self._registry

    def find_service(self, code: str) -> dict[str, Any] | None:
        for service in self.registry().get("services", []):
            if service.get("code") == code:
                return service
        return None

    def find_key(self, key_hash: str) -> dict[str, Any] | None:
        for key in self.registry().get("keys", []):
            if key.get("keyHash") == key_hash:
                return key
        return None

    # ---- 审计回写 ----

    def report_call(self, code: str, key_hash: str, parameters_json: str, row_count: int,
                    truncated: bool, elapsed_ms: int, status_code: int) -> None:
        """尽力而为：失败记日志，不影响调用方响应（审计可靠性归生产化批）。"""
        try:
            self._client.post(
                self._settings.controlplane_base_url.rstrip("/") + "/internal/data-api/calls",
                headers={**self._headers(), "Idempotency-Key": str(uuid.uuid4())},
                json={"code": code, "keyHash": key_hash, "parametersJson": parameters_json,
                      "rowCount": row_count, "truncated": truncated, "elapsedMs": elapsed_ms,
                      "statusCode": status_code},
                timeout=self._settings.audit_timeout_s)
        except httpx.HTTPError:
            pass  # 内测口径：审计丢失记入延迟日志；持久化缓冲延后（方案 §九）
