"""S7：JWKS 直连（oidc_jwks_uri）只打直连端点；discovery 不得被触达。"""
from types import SimpleNamespace

import pytest

import security
from security import OidcVerifier

JWKS_URI = "http://keycloak:8080/auth/realms/data-platform/protocol/openid-connect/certs"
JWKS = {"keys": [{"kid": "k1", "kty": "RSA", "n": "x", "e": "AQAB"}]}


class FakeClient:
    """记录全部请求；非预期 URL 直接失败（discovery 不得被触达）。"""

    requested: list[str] = []

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get(self, url):
        FakeClient.requested.append(url)
        assert url == JWKS_URI, f"未预期 discovery 请求: {url}"
        response = SimpleNamespace(json=lambda: JWKS)
        response.raise_for_status = lambda: response
        return response


@pytest.fixture()
def verifier(monkeypatch):
    FakeClient.requested = []
    monkeypatch.setattr(security.httpx, "Client", FakeClient)
    monkeypatch.setattr(security, "settings", SimpleNamespace(
        oidc_issuer="https://gw.example:8443/auth/realms/data-platform",
        oidc_audience="dataos-quality-runner",
        oidc_jwks_uri=JWKS_URI,
    ))
    return OidcVerifier()


def test_jwks_direct_uri_skips_discovery(verifier):
    assert verifier._load_jwks() == JWKS
    assert FakeClient.requested == [JWKS_URI]


def test_jwks_cached_within_ttl(verifier):
    verifier._load_jwks()
    verifier._load_jwks()
    assert FakeClient.requested == [JWKS_URI]
