"""共享测试桩：stub 控制面客户端（registry 固定投影 + 导出任务台账）与 stub 执行器。

registry 投影形态与控制面 DataApiAdminService.registry() 对齐。
"""
from __future__ import annotations

import hashlib
import os
import sys
import uuid
from pathlib import Path
from typing import Any

import pytest

# 测试不连真实数据面：给启动校验一个占位口令
os.environ.setdefault("DORIS_PASSWORD", "test-only")
os.environ.setdefault("DATA_API_INTERNAL_TOKEN", "test-internal")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

SERVICE = {
    "code": "prescription-daily-summary",
    "name": "处方日汇总",
    "description": "按日期区间汇总处方量",
    "version": "v1",
    "sqlTemplate": (
        "SELECT DATE(cf_date) AS stat_date, COUNT(*) AS prescriptions "
        "FROM ods_ep.ep_mz_cfzb WHERE cf_date BETWEEN :start_date AND :end_date "
        "GROUP BY DATE(cf_date)"
    ),
    "parameters": (
        '[{"name":"start_date","type":"date","required":true},'
        '{"name":"end_date","type":"date","required":true},'
        '{"name":"hospital_code","type":"string","required":false,"values":["H001","H002"]}]'
    ),
    "columns": '[{"name":"stat_date","type":"date"},{"name":"prescriptions","type":"number"}]',
    "maxRows": 3,
    "timeoutSeconds": 30,
}

ROWS = [("2026-08-01", 11), ("2026-08-02", 7), ("2026-08-03", 9), ("2026-08-04", 3)]


class StubControlPlane:
    def __init__(self):
        self.reported: list[dict[str, Any]] = []
        self.registry_data: dict[str, Any] = {"services": [SERVICE], "keys": []}
        self.exports: dict[str, dict[str, Any]] = {}

    def registry(self, force: bool = False) -> dict[str, Any]:
        return self.registry_data

    def find_service(self, code: str) -> dict[str, Any] | None:
        return next((s for s in self.registry_data["services"] if s["code"] == code), None)

    def find_key(self, key_hash: str) -> dict[str, Any] | None:
        return next((k for k in self.registry_data["keys"] if k["keyHash"] == key_hash), None)

    def report_call(self, code: str, key_hash: str, parameters_json: str, row_count: int,
                    truncated: bool, elapsed_ms: int, status_code: int, kind: str = "query") -> None:
        self.reported.append({"code": code, "keyHash": key_hash, "rowCount": row_count,
                              "truncated": truncated, "statusCode": status_code, "kind": kind})

    # ---- 导出任务台账（形态对齐控制面 /internal/data-api/exports* 投影）----

    def create_export(self, code: str, key_hash: str, parameters_json: str) -> dict[str, Any]:
        export_id = f"exp-{uuid.uuid4().hex[:12]}"
        self.exports[export_id] = {"id": export_id, "serviceCode": code, "keyHash": key_hash,
                                   "status": "PENDING", "rowCount": 0, "fileBytes": 0,
                                   "artifactUri": "", "error": "", "expiresAt": "",
                                   "parametersJson": parameters_json, "createdAt": "", "updatedAt": ""}
        return dict(self.exports[export_id])

    def get_export(self, export_id: str) -> dict[str, Any]:
        if export_id not in self.exports:
            raise RuntimeError("404 not found")
        return dict(self.exports[export_id])

    def claim_export(self, export_id: str) -> dict[str, Any]:
        export = self.exports[export_id]
        if export["status"] == "PENDING":
            export["status"] = "RUNNING"
        return dict(export)

    def finalize_export(self, export_id: str, target: str, **fields: Any) -> dict[str, Any]:
        export = self.exports[export_id]
        export["status"] = target
        camel = {"row_count": "rowCount", "file_bytes": "fileBytes", "artifact_uri": "artifactUri",
                 "expires_at": "expiresAt"}
        for name, value in fields.items():
            if value is not None:
                export[camel.get(name, name)] = value
        return dict(export)

    def pending_exports(self) -> list[dict[str, Any]]:
        return [dict(export) for export in self.exports.values() if export["status"] == "PENDING"]

    def reap_stale_exports(self) -> int:
        return 0

    def expire_exports(self) -> int:
        return 0


@pytest.fixture()
def control_plane():
    return StubControlPlane()


@pytest.fixture()
def client(control_plane, tmp_path, monkeypatch):
    """返回 (TestClient, knobs)；knobs["fail"] 置 True 模拟 Doris 不可用。"""
    from fastapi.testclient import TestClient

    import api
    import executor
    import exports
    import main
    from artifacts import ExportArtifactStore

    api.bind(control_plane, type("S", (), {"audit_timeout_s": 0.1})())
    store_settings = type("S", (), {
        "export_dir": str(tmp_path / "export-artifacts"),
        "s3_endpoint": "", "s3_access_key": "", "s3_secret_key": "",
        "s3_bucket": "test-bucket", "s3_region": "us-east-1",
        "export_max_rows": 1000, "export_timeout_s": 30, "export_concurrency": 2,
        "export_retention_days": 7})()
    api.bind_exports(exports.ExportManager(
        control_plane, store_settings, ExportArtifactStore(store_settings)))
    knobs: dict[str, Any] = {"fail": False}

    def fake_execute(sql_template, values, service, settings):
        if knobs["fail"]:
            raise RuntimeError("doris down")
        limit = int(service.get("maxRows", 1000))
        rows = ROWS[:limit]
        return {"columns": ["stat_date", "prescriptions"], "rows": [list(r) for r in rows],
                "rowCount": len(rows), "truncated": len(ROWS) > limit, "elapsedMs": 5}

    def fake_stream_to_csv(sql, args, settings, path, max_rows, timeout_s):
        if knobs["fail"]:
            raise RuntimeError("doris down")
        path.write_text("stat_date,prescriptions\n2026-08-01,11\n2026-08-02,7\n",
                        encoding="utf-8-sig")
        return 2, False

    monkeypatch.setattr(api, "execute", fake_execute)
    monkeypatch.setattr(exports, "stream_to_csv", fake_stream_to_csv)
    return TestClient(main.app), knobs


def key_entry(hash_value: str, service_code: str = SERVICE["code"], quota: int = 100,
              hospitals: str = '["*"]', used: int = 0) -> dict[str, Any]:
    return {"serviceCode": service_code, "keyHash": hash_value, "callerName": "测试调用方",
            "allowedHospitals": hospitals, "dailyQuota": quota, "usedToday": used}


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
