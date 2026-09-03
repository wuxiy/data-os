"""S7：JWKS 直连（oidc_jwks_uri）只打直连端点；空值回退 issuer discovery。"""
from types import SimpleNamespace

import pytest
import security
from security import Authenticator
from settings import Settings

JWKS_URI = "http://keycloak:8080/auth/realms/data-platform/protocol/openid-connect/certs"
ISSUER = "https://gw.example:8443/auth/realms/data-platform"
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


@pytest.fixture(autouse=True)
def fake_http(monkeypatch):
    FakeClient.requested = []
    monkeypatch.setattr(security.httpx, "Client", FakeClient)


def test_jwks_direct_uri_skips_discovery():
    settings = Settings(oidc_issuer=ISSUER, oidc_audience="aud", oidc_jwks_uri=JWKS_URI)
    authenticator = Authenticator(settings)
    loaded = authenticator._load_jwks()
    assert loaded == JWKS
    assert FakeClient.requested == [JWKS_URI]


def test_jwks_cached_within_ttl():
    settings = Settings(oidc_issuer=ISSUER, oidc_audience="aud", oidc_jwks_uri=JWKS_URI)
    authenticator = Authenticator(settings)
    authenticator._load_jwks()
    authenticator._load_jwks()
    assert FakeClient.requested == [JWKS_URI]
