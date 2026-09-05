"""P8（H3）：Doris 熔断、registry stale-grace、审计持久缓冲。"""
from __future__ import annotations

import json

import httpx
import pytest

from auditbuffer import AuditBuffer
from breaker import DorisBreaker
from controlplane import ControlPlaneClient

from conftest import SERVICE, key_entry, sha256

CODE = SERVICE["code"]
API_KEY = "dataos_sk_testkey0001"
KEY_HASH = sha256(API_KEY)
VALID_PARAMS = {"parameters": {"start_date": "2026-08-01", "end_date": "2026-08-31"}}


# ---- 熔断器 ----

def test_breaker_opens_after_consecutive_failures():
    breaker = DorisBreaker(failure_threshold=3, open_seconds=30.0)
    for _ in range(3):
        assert breaker.allow() is True
        breaker.record_failure()
    assert breaker.allow() is False
    assert breaker.state == "OPEN"


def test_breaker_half_open_probe_then_close():
    breaker = DorisBreaker(failure_threshold=1, open_seconds=0.0)
    breaker.record_failure()
    assert breaker.allow() is True   # 冷却 0s：半开放行试探
    assert breaker.allow() is False  # 试探在途，其余拒绝
    breaker.record_success()
    assert breaker.allow() is True
    assert breaker.state == "CLOSED"


def test_breaker_success_resets_consecutive_count():
    breaker = DorisBreaker(failure_threshold=3, open_seconds=30.0)
    breaker.record_failure()
    breaker.record_failure()
    breaker.record_success()
    breaker.record_failure()
    breaker.record_failure()
    assert breaker.allow() is True  # 连败被成功打断，未达阈值


def test_query_reports_circuit_open(client, control_plane):
    """熔断打开后 query 立即 503 DORIS_CIRCUIT_OPEN（不触达 Doris）。"""
    http, knobs = client
    from api import bind_breaker

    breaker = DorisBreaker(failure_threshold=1, open_seconds=3600.0)
    bind_breaker(breaker)
    breaker.record_failure()  # 预热到 OPEN
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]

    response = http.post(f"/v1/services/{CODE}/query", json=VALID_PARAMS,
                         headers={"X-API-Key": API_KEY})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "DORIS_CIRCUIT_OPEN"
    assert control_plane.reported[-1]["statusCode"] == 503
    assert knobs["fail"] is False  # Doris 桩从未被调用


# ---- 审计持久缓冲 ----

def test_audit_buffer_roundtrip_and_dedup(tmp_path):
    buffer = AuditBuffer(tmp_path / "audit.jsonl", max_age_hours=72)
    payload = {"code": CODE, "statusCode": 200}
    headers = {"Idempotency-Key": "idem-1"}
    assert buffer.append(payload, headers) is True
    assert buffer.append(payload, headers) is False  # 同幂等键去重
    assert len(buffer) == 1

    pending = buffer.drain()
    assert pending == [(payload, headers)]
    assert len(buffer) == 0

    buffer.requeue(payload, headers)
    assert len(buffer) == 1


def test_audit_buffer_drops_aged_entries(tmp_path):
    buffer = AuditBuffer(tmp_path / "audit.jsonl", max_age_hours=72)
    path = tmp_path / "audit.jsonl"
    entry = json.dumps({"payload": {"code": CODE}, "headers": {"Idempotency-Key": "old"},
                        "queuedAt": "2020-01-01T00:00:00+00:00"})
    path.write_text(entry + "\n", encoding="utf-8")
    assert buffer.drain() == []


def test_report_call_buffers_and_replays_on_recovery(tmp_path):
    """控制面宕机期间审计落盘；恢复后重放成功清空。"""
    state = {"fail": True, "received": []}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/calls"):
            if state["fail"]:
                raise httpx.ConnectError("control-plane down")
            state["received"].append(json.loads(request.content))
            return httpx.Response(200, json={"accepted": True})
        if request.url.path.endswith("/registry"):
            if state["fail"]:
                raise httpx.ConnectError("control-plane down")
            return httpx.Response(200, json={"services": [], "keys": []})
        raise AssertionError(f"unexpected {request.url}")

    settings = type("S", (), {
        "controlplane_base_url": "http://control-plane:8080",
        "oidc_client_id": "", "oidc_client_secret": "", "internal_token": "t",
        "registry_ttl_s": 30, "audit_timeout_s": 0.1, "registry_grace_s": 300})()
    buffer = AuditBuffer(tmp_path / "audit.jsonl")
    client = ControlPlaneClient(settings, client=httpx.Client(
        transport=httpx.MockTransport(handler), verify=False), audit_buffer=buffer)

    client.report_call(CODE, KEY_HASH, "{}", 5, False, 10, 200)
    assert len(buffer) == 1  # 宕机：入持久缓冲

    state["fail"] = False
    result = client.replay_audit()
    assert result == {"replayed": 1, "remaining": 0}
    assert state["received"][0]["code"] == CODE


# ---- registry stale-grace ----

def test_registry_stale_grace_serves_old_projection_then_gives_up():
    state = {"fail": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if state["fail"]:
            raise httpx.ConnectError("control-plane down")
        return httpx.Response(200, json={"services": [{"code": "svc"}], "keys": []})

    settings = type("S", (), {
        "controlplane_base_url": "http://control-plane:8080",
        "oidc_client_id": "", "oidc_client_secret": "", "internal_token": "t",
        "registry_ttl_s": 30, "audit_timeout_s": 0.1, "registry_grace_s": 300})()
    client = ControlPlaneClient(settings, client=httpx.Client(
        transport=httpx.MockTransport(handler), verify=False))

    first = client.registry()
    assert first["services"][0]["code"] == "svc"

    import time

    state["fail"] = True
    client._registry_expires_at = 0.0  # TTL 已过，强制刷新
    stale = client.registry()  # grace 窗口内：降级用旧投影
    assert stale["services"][0]["code"] == "svc"

    client._registry_fetched_at = time.time() - 301  # 超出 grace
    with pytest.raises(httpx.HTTPError):
        client.registry(force=True)
