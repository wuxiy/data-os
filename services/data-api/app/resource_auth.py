"""资源侧 JWT 校验（G26）：data-api 首个入站服务身份面。

与控制面 /internal/** 的独立强制语义对齐：三配置（ISSUER/AUDIENCE/JWKS_URI）
齐备才启用；未配置时端点 fail-closed（503），绝不静态令牌直通。JWKS 经
httpx 拉取并缓存（签名轮换窗口内复用），验签算法固定 RS256。
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable

import jwt
from jwt.algorithms import RSAAlgorithm


class ResourceAuthError(Exception):
    """token 无效/越权（401 AUTH_REJECTED，message 面向运维定位）。"""


class ResourceAuthNotConfigured(Exception):
    """资源面未配置（503 RESOURCE_AUTH_NOT_CONFIGURED，fail-closed）。"""


class ResourceAuth:
    def __init__(self, issuer: str, audience: str, jwks_uri: str,
                 fetch_jwks: Callable[[str], dict[str, Any]] | None = None,
                 cache_seconds: float = 300.0) -> None:
        if not (issuer and audience and jwks_uri):
            raise ResourceAuthNotConfigured(
                "DATA_API_RESOURCE_ISSUER/AUDIENCE/JWKS_URI 必须同时配置（internal 面独立强制）")
        self._issuer = issuer
        self._audience = audience
        self._jwks_uri = jwks_uri
        self._fetch_jwks = fetch_jwks or _httpx_fetch_jwks
        self._cache_seconds = cache_seconds
        self._lock = threading.Lock()
        self._keys: dict[str, Any] = {}
        self._fetched_at = 0.0

    def validate(self, authorization: str | None) -> dict[str, Any]:
        """校验 Bearer token（签名/iss/aud/exp），返回 claims；失败抛 ResourceAuthError。"""
        if not authorization or not authorization.startswith("Bearer ") or len(authorization) <= 7:
            raise ResourceAuthError("缺少 Bearer 服务令牌")
        token = authorization[7:].strip()
        header: dict[str, Any]
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise ResourceAuthError(f"令牌头不可解析: {exc}") from exc
        kid = header.get("kid")
        if not kid:
            raise ResourceAuthError("令牌缺少 kid")
        key = self._key_of(kid)
        if key is None:
            raise ResourceAuthError("kid 不在 JWKS 内（签名密钥未发布或已轮换）")
        try:
            return jwt.decode(token, key, algorithms=["RS256"],
                              audience=self._audience, issuer=self._issuer)
        except jwt.InvalidAudienceError as exc:
            raise ResourceAuthError(f"audience 不符（期望 {self._audience}）") from exc
        except jwt.InvalidIssuerError as exc:
            raise ResourceAuthError(f"issuer 不符（期望 {self._issuer}）") from exc
        except jwt.ExpiredSignatureError as exc:
            raise ResourceAuthError("服务令牌已过期") from exc
        except jwt.PyJWTError as exc:
            raise ResourceAuthError(f"令牌验签失败: {exc}") from exc

    def _key_of(self, kid: str) -> Any:
        now = time.monotonic()
        with self._lock:
            if kid in self._keys and now - self._fetched_at < self._cache_seconds:
                return self._keys[kid]
            if self._keys and now - self._fetched_at < self._cache_seconds:
                # 缓存有效但 kid 未命中：签名可能已轮换，强制刷新一次
                pass
            document = self._fetch_jwks(self._jwks_uri)
            keys: dict[str, Any] = {}
            for item in document.get("keys", []):
                entry_kid = item.get("kid")
                if not entry_kid:
                    continue
                try:
                    keys[entry_kid] = RSAAlgorithm.from_jwk(item)
                except (ValueError, TypeError):
                    continue  # 非 RSA 密钥（如 HS256 enc）跳过
            if not keys:
                raise ResourceAuthError("JWKS 无可用 RS256 密钥")
            self._keys = keys
            self._fetched_at = now
            return keys.get(kid)


def _httpx_fetch_jwks(uri: str) -> dict[str, Any]:
    import httpx

    response = httpx.get(uri, timeout=5.0)
    response.raise_for_status()
    return response.json()
