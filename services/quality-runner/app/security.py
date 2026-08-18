from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import Header, HTTPException, status

from settings import settings


@dataclass(frozen=True)
class Principal:
    subject: str
    tenant_id: str
    institution_id: str
    scopes: frozenset[str]


class OidcVerifier:
    def __init__(self):
        self._jwks: dict[str, Any] | None = None
        self._expires_at = 0.0

    def _load_jwks(self) -> dict[str, Any]:
        if self._jwks and self._expires_at > time.time():
            return self._jwks
        discovery = settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration"
        with httpx.Client(timeout=3.0) as client:
            config = client.get(discovery).raise_for_status().json()
            jwks = client.get(config["jwks_uri"]).raise_for_status().json()
        self._jwks = jwks
        self._expires_at = time.time() + 300
        return jwks

    def verify(self, token: str) -> Principal:
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
        try:
            header = jwt.get_unverified_header(token)
            kid = header.get("kid")
            key_data = next(item for item in self._load_jwks()["keys"] if item.get("kid") == kid)
            key = jwt.algorithms.RSAAlgorithm.from_jwk(key_data)
            claims = jwt.decode(token, key=key, algorithms=["RS256"], audience=settings.oidc_audience,
                                issuer=settings.oidc_issuer, options={"require": ["exp", "iat", "sub"]})
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="OIDC token invalid") from exc
        scopes = set(str(claims.get("scope", "")).split())
        scopes.update(str(item) for item in claims.get("scp", []) if item)
        tenant = str(claims.get("tenant_id", "")).strip()
        institution = str(claims.get("institution_id", "")).strip()
        if not tenant or not institution:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OIDC token has no tenant scope")
        return Principal(str(claims["sub"]), tenant, institution, frozenset(scopes))


verifier = OidcVerifier()


def principal(authorization: str | None = Header(default=None)) -> Principal:
    if settings.auth_mode == "DISABLED":
        # Explicitly development-only: the API skips tenant comparison for
        # this wildcard principal so synthetic acceptance jobs can exercise
        # named tenants without weakening enforced OIDC deployments.
        return Principal("development", "*", "*", frozenset({"quality:submit", "quality:read", "quality:cancel"}))
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    return verifier.verify(authorization[7:].strip())


def check_scope(current: Principal, required: str) -> None:
    if settings.auth_mode != "DISABLED" and required not in current.scopes:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OIDC token scope is insufficient")
