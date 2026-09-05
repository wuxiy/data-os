"""控制面 registry 客户端：OIDC client_credentials 取 token（dev 可静态令牌），
拉取已发布服务定义 + 有效 Key 投影（TTL 缓存 + stale-grace），并回写调用审计
（失败落持久缓冲，周期重放）。
"""
from __future__ import annotations

import hashlib
import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class ControlPlaneClient:
    def __init__(self, settings: Any, client: httpx.Client | None = None,
                 audit_buffer: Any | None = None):
        self._settings = settings
        self._client = client or httpx.Client(verify=False, timeout=10.0)
        self._token = ""
        self._token_expires_at = 0.0
        self._registry: dict[str, Any] | None = None
        self._registry_expires_at = 0.0
        self._registry_fetched_at = 0.0
        self._lock = threading.Lock()
        self._audit_buffer = audit_buffer

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
        """TTL 缓存拉取；刷新失败时若上次成功投影仍在 grace 窗口内则降级
        用旧投影（stale-grace，P8）——吊销/新 Key 生效延迟放宽为
        TTL + grace，超窗才对调用方 503。"""
        with self._lock:
            now = time.time()
            if not force and self._registry and self._registry_expires_at > now:
                return self._registry
            try:
                response = self._client.get(
                    self._settings.controlplane_base_url.rstrip("/") + "/internal/data-api/registry",
                    headers=self._headers())
                response.raise_for_status()
                self._registry = response.json()
                self._registry_expires_at = now + self._settings.registry_ttl_s
                self._registry_fetched_at = now
            except httpx.HTTPError:
                grace = getattr(self._settings, "registry_grace_s", 300)
                if self._registry and now - self._registry_fetched_at <= grace:
                    logger.warning("registry 刷新失败，stale-grace 降级（age=%.0fs）",
                                   now - self._registry_fetched_at)
                    return self._registry
                raise
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

    # ---- 审计回写（失败落持久缓冲，重放去重靠 Idempotency-Key）----

    def report_call(self, code: str, key_hash: str, parameters_json: str, row_count: int,
                    truncated: bool, elapsed_ms: int, status_code: int,
                    kind: str = "query") -> None:
        payload = {"code": code, "keyHash": key_hash, "parametersJson": parameters_json,
                   "rowCount": row_count, "truncated": truncated, "elapsedMs": elapsed_ms,
                   "statusCode": status_code, "kind": kind}
        headers = {"Idempotency-Key": str(uuid.uuid4())}
        if not self._post_call(payload, headers):
            self._buffer_failure(payload, headers)

    def replay_audit(self) -> dict[str, int]:
        """重放缓冲中的失败审计（维护循环调用）。"""
        if self._audit_buffer is None:
            return {"replayed": 0, "remaining": 0}
        pending = self._audit_buffer.drain()
        replayed = 0
        for payload, headers in pending:
            if self._post_call(payload, headers):
                replayed += 1
            else:
                self._buffer_failure(payload, headers)
        return {"replayed": replayed, "remaining": len(self._audit_buffer)}

    def _post_call(self, payload: dict[str, Any], headers: dict[str, str]) -> bool:
        try:
            self._client.post(
                self._settings.controlplane_base_url.rstrip("/") + "/internal/data-api/calls",
                headers={**self._headers(), **headers},
                json=payload,
                timeout=self._settings.audit_timeout_s)
            return True
        except httpx.HTTPError:
            return False

    def _buffer_failure(self, payload: dict[str, Any], headers: dict[str, str]) -> None:
        if self._audit_buffer is None:
            return  # 无缓冲装配（单测桩）：维持尽力而为口径
        try:
            self._audit_buffer.append(payload, headers)
            logger.warning("审计回写失败已入持久缓冲（剩余 %d 条）", len(self._audit_buffer))
        except Exception:  # noqa: BLE001  缓冲自身故障不影响调用方响应
            logger.exception("审计缓冲写入失败")

    # ---- 导出任务驱动（P7）----

    def create_export(self, code: str, key_hash: str, parameters_json: str) -> dict[str, Any]:
        response = self._client.post(
            self._settings.controlplane_base_url.rstrip("/") + "/internal/data-api/exports",
            headers=self._headers(), json={"code": code, "keyHash": key_hash,
                                           "parametersJson": parameters_json})
        response.raise_for_status()
        return response.json()

    def get_export(self, export_id: str) -> dict[str, Any]:
        response = self._client.get(
            self._settings.controlplane_base_url.rstrip("/")
            + f"/internal/data-api/exports/{export_id}",
            headers=self._headers())
        response.raise_for_status()
        return response.json()

    def pending_exports(self) -> list[dict[str, Any]]:
        response = self._client.get(
            self._settings.controlplane_base_url.rstrip("/") + "/internal/data-api/exports/pending",
            headers=self._headers())
        response.raise_for_status()
        return response.json().get("items", [])

    def claim_export(self, export_id: str) -> dict[str, Any]:
        response = self._client.patch(
            self._settings.controlplane_base_url.rstrip("/")
            + f"/internal/data-api/exports/{export_id}",
            headers=self._headers(), json={"action": "claim"})
        response.raise_for_status()
        return response.json()

    def finalize_export(self, export_id: str, target: str, *, row_count: int = 0,
                        file_bytes: int | None = None, artifact_uri: str | None = None,
                        error: str | None = None, expires_at: str | None = None) -> dict[str, Any]:
        response = self._client.patch(
            self._settings.controlplane_base_url.rstrip("/")
            + f"/internal/data-api/exports/{export_id}",
            headers=self._headers(),
            json={"action": "finalize", "target": target, "rowCount": row_count,
                  "fileBytes": file_bytes, "artifactUri": artifact_uri,
                  "error": error, "expiresAt": expires_at})
        response.raise_for_status()
        return response.json()

    def expire_exports(self) -> int:
        try:
            response = self._client.post(
                self._settings.controlplane_base_url.rstrip("/") + "/internal/data-api/exports/expire",
                headers=self._headers())
            response.raise_for_status()
            return int(response.json().get("expired", 0))
        except httpx.HTTPError:
            return 0  # 维护性操作：失败等下一轮

    def reap_stale_exports(self) -> int:
        try:
            response = self._client.post(
                self._settings.controlplane_base_url.rstrip("/") + "/internal/data-api/exports/reap-stale",
                headers=self._headers(), json={"staleBefore": _iso_now()})
            response.raise_for_status()
            return int(response.json().get("reaped", 0))
        except httpx.HTTPError:
            return 0
