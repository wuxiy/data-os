"""G2G 批次 4 第二刀：前置机采集水位端点测试。"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import edge_watermark
import security
from edge_watermark import router


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(security, "settings", SimpleNamespace(auth_mode="DISABLED"))
    queries: list[str] = []

    def fake_query(sql: str) -> list[tuple]:
        queries.append(sql)
        if "COUNT(*)" in sql and "DATE(" not in sql:
            return [(1234,)]
        if "MAX(" in sql:
            return [("2026-10-04 05:30:00",)]
        return [("2026-09-30", 210), ("2026-10-01", 180)]

    app = FastAPI()
    app.include_router(router(fake_query))
    return TestClient(app), queries


def test_watermarks_returns_aggregates_only(client):
    test_client, captured = client
    response = test_client.get("/api/v1/edge/watermarks")
    assert response.status_code == 200
    body = response.json()
    keys = [item["key"] for item in body["tables"]]
    assert keys == ["cfzb", "ypcfmx"]
    first = body["tables"][0]
    assert first["dataset"] == "ods_ep.ep_mz_cfzb_edge"
    assert first["totalRows"] == 1234
    assert first["latestWriteAt"] == "2026-10-04 05:30:00"
    assert first["dailyCounts"] == [{"date": "2026-09-30", "count": 210},
                                    {"date": "2026-10-01", "count": 180}]
    # 只做聚合查询；表名全部来自白名单，不接收调用方输入
    queries = captured
    assert len(queries) == 6
    for sql in queries:
        assert "SELECT" in sql
        assert "*" not in sql.replace("COUNT(*)", "")
        for database, table in edge_watermark.EDGE_TABLES.values():
            assert f"`{database}`.`{table}`" in sql or "information_schema" in sql or sql.startswith(("SELECT COUNT", "SELECT MAX", "SELECT DATE"))
    # 表名白名单形状（六条查询均指向两张表）
    assert all(
        "ep_mz_cfzb_edge" in sql or "ep_mz_ypcfmx_edge" in sql for sql in queries)
