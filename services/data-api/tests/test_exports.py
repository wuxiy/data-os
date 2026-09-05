"""异步导出（P7，H3）：提交校验、后台完成、状态轮询、下载交付、
归属与生命周期守卫、启动拾取。Doris 流式执行与对象存储均走桩。"""
from __future__ import annotations

import time

from conftest import SERVICE, key_entry, sha256

CODE = SERVICE["code"]
API_KEY = "dataos_sk_testkey0001"
KEY_HASH = sha256(API_KEY)

VALID_PARAMS = {"parameters": {"start_date": "2026-08-01", "end_date": "2026-08-31"}}


def _wait_status(http, export_id, headers, target="SUCCEEDED", timeout_s=5.0):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        body = http.get(f"/v1/exports/{export_id}", headers=headers).json()
        if body.get("status") == target:
            return body
        time.sleep(0.02)
    raise AssertionError(f"导出未到达 {target}: {body}")


def test_export_happy_path_to_download(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    headers = {"X-API-Key": API_KEY}

    response = http.post(f"/v1/services/{CODE}/export", json=VALID_PARAMS, headers=headers)
    assert response.status_code == 202
    export_id = response.json()["exportId"]

    body = _wait_status(http, export_id, headers)
    assert body["rowCount"] == 2
    assert body["fileBytes"] > 0
    assert body["artifactUri"].startswith("file://")
    assert body["expiresAt"] != ""

    # 导出形态审计：kind=export、200、行数入账
    export_reports = [item for item in control_plane.reported if item.get("kind") == "export"]
    assert export_reports and export_reports[-1]["statusCode"] == 200
    assert export_reports[-1]["rowCount"] == 2

    download = http.get(f"/v1/exports/{export_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.headers["content-type"].startswith("text/csv")
    assert "attachment" in download.headers["content-disposition"]
    # utf-8-sig BOM + 表头 + 两行数据（Excel 中文口径）
    assert download.content.startswith(b"\xef\xbb\xbf")
    assert download.content.count(b"\n") == 3
    assert b"stat_date" in download.content


def test_export_submit_validates_params_and_scope(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]

    response = http.post(f"/v1/services/{CODE}/export",
                         json={"parameters": {"end_date": "2026-08-31"}},
                         headers={"X-API-Key": API_KEY})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "PARAM_INVALID"

    control_plane.registry_data["keys"] = [key_entry(KEY_HASH, hospitals='["H001"]')]
    response = http.post(f"/v1/services/{CODE}/export",
                         json={"parameters": {"start_date": "2026-08-01",
                                              "end_date": "2026-08-31",
                                              "hospital_code": "H002"}},
                         headers={"X-API-Key": API_KEY})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "HOSPITAL_NOT_AUTHORIZED"


def test_export_status_ownership_and_quota_free(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    response = http.post(f"/v1/services/{CODE}/export", json=VALID_PARAMS,
                         headers={"X-API-Key": API_KEY})
    export_id = response.json()["exportId"]

    # 他人 Key 看不到任务（存在性不泄漏）
    control_plane.registry_data["keys"].append(
        key_entry(sha256("stranger"), service_code=SERVICE["code"]))
    stranger = http.get(f"/v1/exports/{export_id}", headers={"X-API-Key": "stranger"})
    assert stranger.status_code == 404

    # 状态/下载不烧配额：配额耗尽的 Key 仍能取已完成的产物
    exhausted = key_entry(KEY_HASH, quota=5, used=5)
    control_plane.registry_data["keys"] = [exhausted]
    owner = http.get(f"/v1/exports/{export_id}", headers={"X-API-Key": API_KEY})
    assert owner.status_code == 200


def test_export_download_guards(client, control_plane):
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    headers = {"X-API-Key": API_KEY}
    response = http.post(f"/v1/services/{CODE}/export", json=VALID_PARAMS, headers=headers)
    export_id = response.json()["exportId"]
    _wait_status(http, export_id, headers)  # 先到终态，避免与后台 worker 竞态

    # 未完成 → 409（把桩里的任务拨回 RUNNING 模拟进行中）
    control_plane.exports[export_id]["status"] = "RUNNING"
    conflict = http.get(f"/v1/exports/{export_id}/download", headers=headers)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "EXPORT_NOT_READY"

    # 已过保留期 → 410
    control_plane.exports[export_id]["status"] = "SUCCEEDED"
    control_plane.exports[export_id]["expiresAt"] = "2000-01-01T00:00:00+00:00"
    gone = http.get(f"/v1/exports/{export_id}/download", headers=headers)
    assert gone.status_code == 410
    assert gone.json()["detail"]["code"] == "EXPORT_EXPIRED"


def test_export_worker_failure_is_terminal(client, control_plane):
    http, knobs = client
    knobs["fail"] = True
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    headers = {"X-API-Key": API_KEY}
    response = http.post(f"/v1/services/{CODE}/export", json=VALID_PARAMS, headers=headers)
    assert response.status_code == 202
    export_id = response.json()["exportId"]

    body = _wait_status(http, export_id, headers, target="FAILED")
    assert "暂不可用" in body["error"]
    export_reports = [item for item in control_plane.reported if item.get("kind") == "export"]
    assert export_reports[-1]["statusCode"] == 503


def test_export_recovery_picks_pending(client, control_plane):
    """进程重启拾取：台账遗留的 PENDING 经 recover() 重排后完成。"""
    http, _ = client
    control_plane.registry_data["keys"] = [key_entry(KEY_HASH)]
    pending = control_plane.create_export(CODE, KEY_HASH,
                                          '{"end_date": "2026-08-31", "start_date": "2026-08-01"}')
    import api as api_module

    recovered = api_module._exports.recover()
    assert recovered["picked"] == 1

    body = _wait_status(http, pending["id"], {"X-API-Key": API_KEY})
    assert body["status"] == "SUCCEEDED"
    assert body["rowCount"] == 2
