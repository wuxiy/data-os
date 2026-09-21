"""映射聚合验证契约（G23）：登记面校验（数据集/列名/转换白名单）、聚合输出
（兼容性/空值率/覆盖率/TOP N）、无行数据、鉴权挂载。Doris 经桩分发。"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "app"))

from mapping_validation import MappingValidationItem, MappingValidationRequest, router  # noqa: E402
from security import Principal, principal  # noqa: E402

# 桩 Doris：按 SQL 形状分发（information_schema / COUNT / AVG / GROUP BY）
COLUMNS = {
    ("ods_ep", "ep_mz_cfzb"): [
        ("channel_code", "varchar"), ("cf_bh", "varchar"), ("cf_date", "datetime"),
        ("fee", "decimal"), ("patient_flag", "tinyint"),
    ],
}


def stub_query(sql: str):
    lowered = sql.lower()
    if "information_schema.columns" in lowered:
        for (db, table), columns in COLUMNS.items():
            if f"'{db}'" in sql and f"'{table}'" in sql:
                return columns
        return []
    if "count(*)" in lowered and "group by" not in lowered:
        return [(1000,)]
    if "avg(case when" in lowered:
        # channel_code 10% 空值，其余 0
        return [(0.1,)] if "channel_code" in sql else [(0.0,)]
    if "group by" in lowered:
        if "channel_code" in sql:
            return [("OPD", 700), ("ER", 180), ("PHY", 60), ("TEL", 40), ("FAX", 20)]
        return []
    raise AssertionError(f"意外 SQL: {sql}")


@pytest.fixture()
def client():
    app = FastAPI()
    app.include_router(router(stub_query))
    app.dependency_overrides[principal] = lambda: Principal(
        "tester", "*", "*", {"quality:submit", "quality:read"})
    return TestClient(app)


def _body(items, dataset="ods_ep.ep_mz_cfzb"):
    return MappingValidationRequest(dataset=dataset, items=items).model_dump()


def test_aggregate_contract_without_row_data(client):
    items = [
        MappingValidationItem(sourceColumn="channel_code", targetType="CODE",
                              transform="VALUE_MAP", transformParam='{"OPD":"OPD","ER":"ER"}'),
        MappingValidationItem(sourceColumn="cf_bh", targetType="STRING", transform="COPY"),
        MappingValidationItem(sourceColumn="cf_date", targetType="DATE",
                              transform="DATE_FORMAT", transformParam="yyyy-MM-dd"),
        MappingValidationItem(sourceColumn="fee", targetType="DECIMAL", transform="COPY"),
    ]
    response = client.post("/api/v1/mapping-validations", json=_body(items))
    assert response.status_code == 200
    payload = response.json()
    assert payload["dataset"] == "ods_ep.ep_mz_cfzb"
    assert payload["rowCount"] == 1000
    by_column = {item["sourceColumn"]: item for item in payload["items"]}
    # VALUE_MAP 覆盖率 = (700+180)/(700+180+60+40+20) = 0.88；未映射 TOP N 有序
    assert round(by_column["channel_code"]["coverage"], 3) == 0.88
    assert [entry["value"] for entry in by_column["channel_code"]["unmappedTop"]] == \
        ["PHY", "TEL", "FAX"]
    assert by_column["channel_code"]["nullRate"] == 0.1
    assert by_column["channel_code"]["compatible"] is True  # CODE ← varchar
    # COPY：varchar→STRING 兼容；decimal→DECIMAL 兼容
    assert by_column["cf_bh"]["compatible"] is True
    assert by_column["fee"]["compatible"] is True
    # DATE_FORMAT：datetime→DATE 兼容
    assert by_column["cf_date"]["compatible"] is True
    # 非 CODE 目标不携带覆盖率/未映射面（无行数据承诺的一部分）
    assert "coverage" not in by_column["cf_bh"]
    assert "unmappedTop" not in by_column["cf_bh"]


def test_copy_type_mismatch_marked_incompatible(client):
    items = [MappingValidationItem(sourceColumn="cf_bh", targetType="INTEGER", transform="COPY")]
    payload = client.post("/api/v1/mapping-validations", json=_body(items)).json()
    assert payload["items"][0]["compatible"] is False


def test_unregistered_dataset_and_column_and_transform_rejected(client):
    # 未登记数据集
    response = client.post("/api/v1/mapping-validations", json=_body(
        [MappingValidationItem(sourceColumn="cf_bh", targetType="STRING", transform="COPY")],
        dataset="ods_ep.not_registered"))
    assert response.status_code == 400
    assert "未登记" in response.json()["detail"]
    # 列不存在
    response = client.post("/api/v1/mapping-validations", json=_body(
        [MappingValidationItem(sourceColumn="no_such_column", targetType="STRING", transform="COPY")]))
    assert response.status_code == 400
    assert "列不存在" in response.json()["detail"]
    # 非法转换（任意 SQL 拒绝面）
    response = client.post("/api/v1/mapping-validations", json=_body(
        [MappingValidationItem(sourceColumn="cf_bh", targetType="STRING",
                               transform="SELECT * FROM ods_ep.ep_mz_cfzb")]))
    assert response.status_code == 400
    assert "非法转换" in response.json()["detail"]


def test_identifier_safety_rejects_injection(client):
    response = client.post("/api/v1/mapping-validations", json=_body(
        [MappingValidationItem(sourceColumn="cf_bh) UNION SELECT 1 --",
                               targetType="STRING", transform="COPY")]))
    assert response.status_code == 400
    assert "列名非法" in response.json()["detail"]


def test_requires_quality_read_scope(client):
    client.app.dependency_overrides[principal] = lambda: Principal(
        "caller", "*", "*", {"quality:submit"})
    response = client.post("/api/v1/mapping-validations", json=_body(
        [MappingValidationItem(sourceColumn="cf_bh", targetType="STRING", transform="COPY")]))
    assert response.status_code == 403
