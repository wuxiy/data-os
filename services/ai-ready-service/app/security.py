"""服务间认证：OIDC（JWKS 验签，issuer 非空时启用）或共享静态令牌。

与 quality-runner 的 OidcVerifier 同姿势；dev 环境可用 AI_READY_API_TOKEN
静态令牌运行（两项都未配置时 /assess 拒绝执行）。
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import jwt
from fastapi import Header, HTTPException, status

from settings import Settings


class Authenticator:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._jwks: dict[str, Any] | None = None
        self._jwks_expires_at = 0.0

    def require(self, authorization: str | None) -> str:
        token = (authorization or "").removeprefix("Bearer ").strip()
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
        if self._settings.oidc_issuer:
            return self._verify_oidc(token)
        if self._settings.api_token and token == self._settings.api_token:
            return "service-token"
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")

    def _verify_oidc(self, token: str) -> str:
        try:
            header = jwt.get_unverified_header(token)
            key_data = next(item for item in self._load_jwks()["keys"]
                            if item.get("kid") == header.get("kid"))
            key = jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
            claims = jwt.decode(token, key=key, algorithms=["RS256"],
                                audience=self._settings.oidc_audience,
                                issuer=self._settings.oidc_issuer,
                                options={"require": ["exp", "iat", "sub"]})
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                detail="OIDC token invalid") from exc
        return str(claims["sub"])

    def _load_jwks(self) -> dict[str, Any]:
        if self._jwks and self._jwks_expires_at > time.time():
            return self._jwks
        if self._settings.oidc_jwks_uri:
            # S7：内网 JWKS 直连（http://keycloak:8080/...），issuer 声明仍按
            # oidc_issuer（网关值）校验；TLS 免除自签证书依赖。
            with httpx.Client(timeout=3.0) as client:
                self._jwks = client.get(self._settings.oidc_jwks_uri).raise_for_status().json()
        else:
            discovery = self._settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration"
            # 内网 dev 口径：Keycloak 经网关自签证书暴露 discovery/JWKS（生产化换
            # JWKS 直连或 truststore，备忘）
            with httpx.Client(timeout=3.0, verify=False) as client:
                config = client.get(discovery).raise_for_status().json()
                self._jwks = client.get(config["jwks_uri"]).raise_for_status().json()
        self._jwks_expires_at = time.time() + 300
        return self._jwks
