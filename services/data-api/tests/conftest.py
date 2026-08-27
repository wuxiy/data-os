"""共享测试桩：stub 控制面客户端（registry 固定投影）与 stub 执行器。

registry 投影形态与控制面 DataApiAdminService.registry() 对齐。
"""
from __future__ import annotations

import hashlib
import os
import sys
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

    def registry(self, force: bool = False) -> dict[str, Any]:
        return self.registry_data

    def find_service(self, code: str) -> dict[str, Any] | None:
        return next((s for s in self.registry_data["services"] if s["code"] == code), None)

    def find_key(self, key_hash: str) -> dict[str, Any] | None:
        return next((k for k in self.registry_data["keys"] if k["keyHash"] == key_hash), None)

    def report_call(self, code: str, key_hash: str, parameters_json: str, row_count: int,
                    truncated: bool, elapsed_ms: int, status_code: int) -> None:
        self.reported.append({"code": code, "keyHash": key_hash, "rowCount": row_count,
                              "truncated": truncated, "statusCode": status_code})


@pytest.fixture()
def control_plane():
    return StubControlPlane()


@pytest.fixture()
def client(control_plane, monkeypatch):
    """返回 (TestClient, knobs)；knobs["fail"] 置 True 模拟 Doris 不可用。"""
    from fastapi.testclient import TestClient

    import api
    import executor
    import main

    api.bind(control_plane, type("S", (), {"audit_timeout_s": 0.1})())
    knobs: dict[str, Any] = {"fail": False}

    def fake_execute(sql_template, values, service, settings):
        if knobs["fail"]:
            raise RuntimeError("doris down")
        limit = int(service.get("maxRows", 1000))
        rows = ROWS[:limit]
        return {"columns": ["stat_date", "prescriptions"], "rows": [list(r) for r in rows],
                "rowCount": len(rows), "truncated": len(ROWS) > limit, "elapsedMs": 5}

    monkeypatch.setattr(api, "execute", fake_execute)
    return TestClient(main.app), knobs


def key_entry(hash_value: str, service_code: str = SERVICE["code"], quota: int = 100,
              hospitals: str = '["*"]', used: int = 0) -> dict[str, Any]:
    return {"serviceCode": service_code, "keyHash": hash_value, "callerName": "测试调用方",
            "allowedHospitals": hospitals, "dailyQuota": quota, "usedToday": used}


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
