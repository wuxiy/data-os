"""调用方自助面（P8 余项）：/v1/me 画像、调用史、合同事件轮询、订阅 CRUD/test。
全部凭 X-API-Key，不烧配额（配额耗尽的 Key 仍可查询与退订）。
"""
from __future__ import annotations

from conftest import SERVICE, key_entry, sha256

CODE = SERVICE["code"]
API_KEY = "dataos_sk_testkey0001"
KEY_HASH = sha256(API_KEY)
HEADERS = {"X-API-Key": API_KEY}


def test_me_returns_profile_with_quota(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH, quota=100, used=7)]
    response = http.get("/v1/me", headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["callerName"] == "测试调用方"
    assert body["service"]["code"] == CODE
    assert "sqlTemplate" not in body["service"]  # 契约视图不出 SQL
    assert body["dailyQuota"] == 100
    assert body["usedToday"] == 7


def test_selfservice_endpoints_do_not_burn_quota(client, control_plane):
    http, _ = client
    # 配额已耗尽：查询面应 429，自助面照常可用（产物交付与自助管理不属于新调用）
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH, quota=5, used=5)]
    query = http.post(f"/v1/services/{CODE}/query",
                      json={"parameters": {"start_date": "2026-08-01", "end_date": "2026-08-31"}},
                      headers=HEADERS)
    assert query.status_code == 429
    assert http.get("/v1/me", headers=HEADERS).status_code == 200
    assert http.get("/v1/usage/calls", headers=HEADERS).status_code == 200
    assert http.get("/v1/contract-events", headers=HEADERS).status_code == 200
    # 429 查询结局本身审计（C1 口径）；自助面在其后不新增任何审计
    assert len(control_plane.reported) == 1
    assert control_plane.reported[0]["statusCode"] == 429


def test_usage_calls_and_contract_events(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    calls = http.get("/v1/usage/calls?limit=5", headers=HEADERS)
    assert calls.status_code == 200
    assert calls.json()["items"][0]["kind"] == "query"

    events = http.get("/v1/contract-events", headers=HEADERS)
    assert events.status_code == 200
    item = events.json()["items"][0]
    assert item["changeType"] == "UPDATED"
    assert item["eventId"]  # 调用方按 eventId 幂等消费


def test_subscription_crud_and_test(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]

    listing = http.get("/v1/subscriptions", headers=HEADERS)
    assert listing.status_code == 200
    assert listing.json()["total"] == 1

    created = http.post("/v1/subscriptions",
                        json={"webhookUrl": "https://caller.example/hook"}, headers=HEADERS)
    assert created.status_code == 201
    assert created.json()["subscriptionId"] == "sub-1"
    assert created.json()["webhookSecret"]  # secret 只回显一次

    tested = http.post("/v1/subscriptions/sub-1/test", headers=HEADERS)
    assert tested.status_code == 200
    assert tested.json()["eventId"] == "ev-test"

    deleted = http.delete("/v1/subscriptions/sub-1", headers=HEADERS)
    assert deleted.status_code == 204
    missing = http.delete("/v1/subscriptions/sub-404", headers=HEADERS)
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "SUBSCRIPTION_NOT_FOUND"


def test_subscription_rejects_bad_webhook(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    rejected = http.post("/v1/subscriptions",
                         json={"webhookUrl": "http://insecure.example/hook"}, headers=HEADERS)
    assert rejected.status_code == 400
    assert rejected.json()["detail"]["code"] == "SUBSCRIPTION_INVALID"


def test_selfservice_requires_valid_key(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    anonymous = http.get("/v1/me")
    assert anonymous.status_code == 401
    invalid = http.get("/v1/me", headers={"X-API-Key": "dataos_sk_wrong"})
    assert invalid.status_code == 401
    assert invalid.json()["detail"]["code"] == "API_KEY_INVALID"
