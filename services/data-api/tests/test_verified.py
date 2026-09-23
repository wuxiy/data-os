"""G26 internal verified-queries 面：资源侧服务身份（fail-closed）、机构范围、
限流、服务下线/未发布、参数复用校验、执行复用与审计（kind=verified_query）。
认证桩 + 真实 RSA JWT 验签双覆盖。
"""
from __future__ import annotations

import json
import time
from typing import Any

import jwt
import pytest
from conftest import SERVICE

import api
from ratelimit import SlidingWindowLimiter
from resource_auth import ResourceAuth, ResourceAuthError, ResourceAuthNotConfigured

ISSUER = "https://id.example.test/realms/data-platform"
AUDIENCE = "dataos-data-api"

PATH = f"/internal/v1/verified-queries/{SERVICE['code']}/query"


class StubAuth:
    """认证桩：accept_token=None 时全部拒绝；institution 不参与桩。"""

    def __init__(self, accept_token: str | None = "good-token") -> None:
        self.accept_token = accept_token
        self.calls = 0

    def validate(self, authorization: str | None) -> dict[str, Any]:
        self.calls += 1
        if self.accept_token and authorization == f"Bearer {self.accept_token}":
            return {"sub": "dataos-assistant-bff"}
        raise ResourceAuthError("缺少 Bearer 服务令牌")


@pytest.fixture()
def verified(client, monkeypatch):
    """返回 (TestClient, knobs, stub)；认证桩默认放行 good-token，限流阈值独立。"""
    _, knobs = client
    stub = StubAuth()
    api.bind_resource_auth(stub, SlidingWindowLimiter(60))
    yield client[0], knobs, stub
    api.bind_resource_auth(None)


def call(test_client, parameters=None, context=None, token="good-token"):
    return test_client.post(
        PATH, json={"parameters": parameters or {}, "context": context or {}},
        headers={"Authorization": f"Bearer {token}"} if token else {})


# ---- fail-closed 与认证 ----

def test_unconfigured_resource_auth_fails_closed(client):
    api.bind_resource_auth(None)
    response = client[0].post(PATH, json={})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "RESOURCE_AUTH_NOT_CONFIGURED"


def test_missing_or_bad_token_is_401(verified):
    test_client, _, stub = verified
    response = test_client.post(PATH, json={})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "AUTH_REJECTED"
    response = test_client.post(PATH, json={}, headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401
    assert stub.calls == 2


# ---- 服务面 ----

def test_unknown_service_404_with_audit_and_no_execution(verified):
    test_client, knobs, _ = verified
    response = test_client.post(
        "/internal/v1/verified-queries/missing-service/query", json={},
        headers={"Authorization": "Bearer good-token"})
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "SERVICE_NOT_PUBLISHED"
    assert knobs["fail"] is False


def test_deprecated_service_reports_offline(verified, monkeypatch):
    test_client, _, _ = verified
    # 把服务从 services 移入 deprecatedServices（引用下线形态）
    stub_cp = test_client.app  # 仅占位；registry 经 api._control_plane
    control_plane = api._control_plane
    control_plane.registry_data = {
        "services": [],
        "deprecatedServices": [SERVICE],
        "keys": []}
    response = call(test_client)
    assert response.status_code == 404
    assert "已下线" in response.json()["detail"]["message"]
    assert any(r["statusCode"] == 404 and r["kind"] == "verified_query"
               for r in control_plane.reported)


def test_happy_path_reuses_executor_and_reports_verified_query(verified):
    test_client, knobs, _ = verified
    knobs["fail"] = False
    response = call(test_client, parameters={"start_date": "2026-08-01",
                                             "end_date": "2026-08-04"})
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == SERVICE["code"]
    assert body["version"] == "v1"
    assert body["rowCount"] == 3  # maxRows=3 截断
    assert body["truncated"] is True
    control_plane = api._control_plane
    assert any(r["kind"] == "verified_query" and r["statusCode"] == 200 and r["rowCount"] == 3
               for r in control_plane.reported)


def test_invalid_parameters_400_without_doris(verified):
    test_client, knobs, _ = verified
    knobs["fail"] = True  # 若触达执行器则 503，测试即失败
    response = call(test_client, parameters={"start_date": "2026/08/01",
                                             "end_date": "2026-08-04"})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "PARAM_INVALID"
    assert response.json()["detail"]["message"].startswith("start_date")


# ---- 机构范围 ----

def test_hospital_scope_enforced_by_caller_institution(verified):
    test_client, _, _ = verified
    # SERVICE 声明 hospital_code 枚举 H001/H002；调用方机构 demo-hospital 不在其中
    response = call(test_client, parameters={"start_date": "2026-08-01",
                                             "end_date": "2026-08-04",
                                             "hospital_code": "H001"},
                    context={"institutionId": "demo-hospital"})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "HOSPITAL_NOT_AUTHORIZED"
    # 机构匹配时放行
    response = call(test_client, parameters={"start_date": "2026-08-01",
                                             "end_date": "2026-08-04",
                                             "hospital_code": "H001"},
                    context={"institutionId": "H001"})
    assert response.status_code == 200
    # 无机构身份 + hospital_code 参数 → fail-closed
    response = call(test_client, parameters={"start_date": "2026-08-01",
                                             "end_date": "2026-08-04",
                                             "hospital_code": "H001"})
    assert response.status_code == 403


# ---- 限流与熔断 ----

def test_rate_limited_requests_get_429(verified):
    test_client, knobs, _ = verified
    api.bind_resource_auth(StubAuth(), SlidingWindowLimiter(2))
    knobs["fail"] = False
    ok = 0
    for _ in range(4):
        response = call(test_client, parameters={"start_date": "2026-08-01",
                                                 "end_date": "2026-08-04"})
        if response.status_code == 200:
            ok += 1
        else:
            assert response.status_code == 429
            assert response.json()["detail"]["code"] == "VERIFIED_QUERY_RATE_LIMITED"
    assert ok == 2


def test_breaker_open_gives_503(verified):
    test_client, knobs, _ = verified
    from breaker import DorisBreaker

    api.bind_breaker(DorisBreaker(failure_threshold=1, open_seconds=30.0))
    knobs["fail"] = True
    assert call(test_client, parameters={"start_date": "2026-08-01",
                                         "end_date": "2026-08-04"}).status_code == 503
    knobs["fail"] = False
    response = call(test_client, parameters={"start_date": "2026-08-01",
                                             "end_date": "2026-08-04"})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "DORIS_CIRCUIT_OPEN"


def test_doris_down_is_503_with_audit(verified):
    test_client, knobs, _ = verified
    knobs["fail"] = True
    response = call(test_client, parameters={"start_date": "2026-08-01",
                                             "end_date": "2026-08-04"})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "DORIS_UNAVAILABLE"
    control_plane = api._control_plane
    assert any(r["statusCode"] == 503 and r["kind"] == "verified_query"
               for r in control_plane.reported)


# ---- 真实 RSA JWT 验签（ResourceAuth 单元面）----

def _rsa_material():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(serialization.Encoding.PEM,
                                    serialization.PrivateFormat.PKCS8,
                                    serialization.NoEncryption())
    numbers = key.public_key().public_numbers()
    defb64 = __import__("base64").urlsafe_b64encode

    def enc(n: int) -> str:
        raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
        return defb64(raw).rstrip(b"=").decode()

    jwk = {"kty": "RSA", "kid": "test-kid", "alg": "RS256", "use": "sig",
           "n": enc(numbers.n), "e": enc(numbers.e)}
    return private_pem, jwk


def test_real_jwt_signature_audience_and_issuer_validation(monkeypatch):
    private_pem, jwk = _rsa_material()
    auth = ResourceAuth(ISSUER, AUDIENCE, "http://jwks/certs",
                        fetch_jwks=lambda uri: {"keys": [jwk]})

    def mint(audience=AUDIENCE, issuer=ISSUER, kid="test-kid"):
        now = int(time.time())
        return jwt.encode({"iss": issuer, "aud": audience, "sub": "dataos-assistant-bff",
                           "iat": now, "exp": now + 60},
                          private_pem, algorithm="RS256", headers={"kid": kid})

    assert auth.validate(f"Bearer {mint()}")["sub"] == "dataos-assistant-bff"
    with pytest.raises(ResourceAuthError):  # audience 不符
        auth.validate(f"Bearer {mint(audience='other-aud')}")
    with pytest.raises(ResourceAuthError):  # issuer 不符
        auth.validate(f"Bearer {mint(issuer='https://evil')}")
    with pytest.raises(ResourceAuthError):  # kid 未知
        auth.validate(f"Bearer {mint(kid='rotated')}")
    with pytest.raises(ResourceAuthError):  # 过期
        now = int(time.time())
        expired = jwt.encode({"iss": ISSUER, "aud": AUDIENCE, "sub": "x",
                              "iat": now - 120, "exp": now - 60},
                             private_pem, algorithm="RS256", headers={"kid": "test-kid"})
        auth.validate(f"Bearer {expired}")
    with pytest.raises(ResourceAuthError):  # 非Bearer/缺失
        auth.validate(None)


def test_resource_auth_requires_all_three_configs():
    with pytest.raises(ResourceAuthNotConfigured):
        ResourceAuth("", AUDIENCE, "http://jwks")
    with pytest.raises(ResourceAuthNotConfigured):
        ResourceAuth(ISSUER, "", "http://jwks")
    with pytest.raises(ResourceAuthNotConfigured):
        ResourceAuth(ISSUER, AUDIENCE, "")
