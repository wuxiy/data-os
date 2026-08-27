"""API 契约：认证（401）、授权（403）、配额（429）、参数（400）、
执行（200/截断/503）与审计回写。"""
from __future__ import annotations

from conftest import SERVICE, key_entry, sha256

CODE = SERVICE["code"]
API_KEY = "dataos_sk_testkey0001"
KEY_HASH = sha256(API_KEY)


def test_query_requires_api_key(client):
    http, _ = client
    response = http.post(f"/v1/services/{CODE}/query", json={"parameters": {}})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "API_KEY_REQUIRED"


def test_invalid_api_key_is_401(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    response = http.post(f"/v1/services/{CODE}/query", json={"parameters": {}},
                         headers={"X-API-Key": "dataos_sk_wrong"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "API_KEY_INVALID"


def test_key_bound_to_other_service_is_403(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(sha256("other"), service_code="other-service")]
    response = http.post(f"/v1/services/{CODE}/query", json={"parameters": {}},
                         headers={"X-API-Key": "other"})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "SERVICE_NOT_AUTHORIZED"


def test_quota_exceeded_is_429(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH, quota=5, used=5)]
    response = http.post(f"/v1/services/{CODE}/query", json={"parameters": {}},
                         headers={"X-API-Key": API_KEY})
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "QUOTA_EXCEEDED"


def test_query_happy_path_with_truncation_and_audit(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    response = http.post(f"/v1/services/{CODE}/query", json={
        "parameters": {"start_date": "2026-08-01", "end_date": "2026-08-31"}},
        headers={"X-API-Key": API_KEY})
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == CODE
    assert body["rowCount"] == 3          # maxRows=3
    assert body["truncated"] is True      # 桩有 4 行
    assert body["columns"] == ["stat_date", "prescriptions"]
    # 审计回写：200 + 行数 + 截断标记
    assert control_plane.reported[-1]["statusCode"] == 200
    assert control_plane.reported[-1]["rowCount"] == 3
    assert control_plane.reported[-1]["truncated"] is True


def test_param_violation_is_400_and_audited(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    response = http.post(f"/v1/services/{CODE}/query", json={
        "parameters": {"end_date": "2026-08-31"}},  # 缺 start_date
        headers={"X-API-Key": API_KEY})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "PARAM_INVALID"
    assert control_plane.reported[-1]["statusCode"] == 400


def test_hospital_out_of_scope_is_403(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH, hospitals='["H001"]')]
    response = http.post(f"/v1/services/{CODE}/query", json={
        "parameters": {"start_date": "2026-08-01", "end_date": "2026-08-31",
                       "hospital_code": "H002"}},
        headers={"X-API-Key": API_KEY})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "HOSPITAL_NOT_AUTHORIZED"


def test_doris_unavailable_is_503_and_audited(client, control_plane):
    http, knobs = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    knobs["fail"] = True
    response = http.post(f"/v1/services/{CODE}/query", json={
        "parameters": {"start_date": "2026-08-01", "end_date": "2026-08-31"}},
        headers={"X-API-Key": API_KEY})
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "DORIS_UNAVAILABLE"
    assert control_plane.reported[-1]["statusCode"] == 503


def test_catalog_and_schema_hide_sql_template(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    catalog = http.get("/v1/services", headers={"X-API-Key": API_KEY})
    assert catalog.status_code == 200
    body = catalog.json()
    assert body["total"] == 1
    assert "sqlTemplate" not in body["items"][0]
    assert body["items"][0]["parameters"][0]["name"] == "start_date"

    schema = http.get(f"/v1/services/{CODE}/schema", headers={"X-API-Key": API_KEY})
    assert schema.status_code == 200
    assert "sqlTemplate" not in schema.json()
