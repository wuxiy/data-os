"""G2G 批次 2 首刀：动态规则编译器与管理面 API 的测试。"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from db import RunnerDatabase
from rulegen import DynamicRuleSpec, selector_for


def spec(**overrides):
    base = dict(
        rule_id="quality.dynamic.sample",
        rule_type="NOT_NULL",
        dataset_id="ods_ep.ep_order",
        column="PAY_STATUS",
        params={},
        evidence_columns=[{"name": "ID", "classification": "IDENTIFIER"},
                          {"name": "PAY_STATUS", "classification": "CATEGORY"}],
    )
    base.update(overrides)
    return DynamicRuleSpec(**base)


def test_compiles_eight_rule_types_with_expected_shapes():
    cases = {
        "NOT_NULL": ("SELECT `ID`, `PAY_STATUS` FROM `ods_ep`.`ep_order` WHERE `PAY_STATUS` IS NULL",
                     spec()),
        "NOT_NULL_BLANK": ("SELECT `ID`, `PAY_STATUS` FROM `ods_ep`.`ep_order` "
                           "WHERE `PAY_STATUS` IS NULL OR `PAY_STATUS` = ''",
                           spec(params={"checkBlank": True})),
        "UNIQUE": ("SELECT `PAY_STATUS` AS unique_field, COUNT(*) AS n_records FROM `ods_ep`.`ep_order` "
                   "WHERE `PAY_STATUS` IS NOT NULL GROUP BY `PAY_STATUS` HAVING COUNT(*) > 1",
                   spec(rule_type="UNIQUE")),
        "VAL_SET": ("SELECT `PAY_STATUS` AS value_field, COUNT(*) AS n_records FROM `ods_ep`.`ep_order` "
                    "WHERE `PAY_STATUS` IS NOT NULL AND `PAY_STATUS` NOT IN (0, 1, 'PAID') "
                    "GROUP BY `PAY_STATUS`",
                    spec(rule_type="VAL_SET", params={"values": [0, 1, "PAID"]})),
        "VAL_MINMAX": ("SELECT `ID`, `PAY_STATUS` FROM `ods_ep`.`ep_order` "
                       "WHERE `PAY_STATUS` IS NOT NULL AND (`PAY_STATUS` < 0 OR `PAY_STATUS` > 9)",
                       spec(rule_type="VAL_MINMAX", params={"minVal": 0, "maxVal": 9})),
        "VAL_LEN": ("SELECT `ID`, `PAY_STATUS` FROM `ods_ep`.`ep_order` "
                    "WHERE `PAY_STATUS` IS NOT NULL AND (CHAR_LENGTH(`PAY_STATUS`) > 8)",
                    spec(rule_type="VAL_LEN", params={"maxLen": 8})),
        "STR_REGEX": ("SELECT `ID`, `PAY_STATUS` FROM `ods_ep`.`ep_order` "
                      "WHERE `PAY_STATUS` IS NOT NULL AND `PAY_STATUS` NOT REGEXP '^[0-9]+'",
                      spec(rule_type="STR_REGEX", params={"regex": "^[0-9]+"})),
        "FK_REF": ("SELECT a.`PAY_STATUS` AS from_field FROM `ods_ep`.`ep_order` a "
                   "LEFT JOIN `ods_ep`.`ep_dict` r ON a.`PAY_STATUS` = r.`CODE` "
                   "WHERE a.`PAY_STATUS` IS NOT NULL AND r.`CODE` IS NULL GROUP BY a.`PAY_STATUS`",
                   spec(rule_type="FK_REF", params={"refDataset": "ods_ep.ep_dict", "refColumn": "CODE"})),
        "SQL": ("SELECT ID FROM ods_ep.ep_order WHERE PAY_STATUS IS NULL",
                spec(rule_type="SQL", column="",
                     params={"sql": "SELECT ID FROM ods_ep.ep_order WHERE PAY_STATUS IS NULL;"})),
    }
    for label, (expected, target) in cases.items():
        assert target.validate().compile_sql() == expected, label


def test_compiles_second_cut_rule_types_with_expected_shapes():
    """第二刀 7 类：跨表比较、统计比较（表/SQL）、明细汇总、字段逻辑、更新率、时间连续。"""
    join = {"targetJoinCols": ["PATIENT_ID"], "refJoinCols": ["PID"]}
    cases = {
        "CROSS_VAL_COMPARE": (
            "SELECT t.`ID`, t.`PAY_STATUS` FROM `ods_ep`.`ep_order` t "
            "JOIN `ods_ep`.`patient` r ON t.`PATIENT_ID` = r.`PID` "
            "WHERE t.`PAY_STATUS` <> r.`NAME`",
            spec(rule_type="CROSS_VAL_COMPARE",
                 params={"refDataset": "ods_ep.patient", "refColumn": "NAME", **join})),
        "STAT_VAL_COMPARE": (
            "SELECT c.check_value, r.ref_value FROM (SELECT COUNT(*) FROM `ods_ep`.`ep_order`) c "
            "JOIN (SELECT SUM(`AMOUNT`) FROM `ods_ep`.`ep_order_history`) r "
            "WHERE c.check_value <> r.ref_value OR c.check_value IS NULL OR r.ref_value IS NULL",
            spec(rule_type="STAT_VAL_COMPARE", params={
                "op": "COUNT", "refOp": "SUM",
                "refDataset": "ods_ep.ep_order_history", "refColumn": "AMOUNT"})),
        "SQL_STAT_VAL": (
            "SELECT c.check_value, r.ref_value FROM (SELECT COUNT(*) FROM ods_ep.ep_order) c "
            "JOIN (SELECT COUNT(*) FROM ods_ep.ep_order_history) r "
            "WHERE c.check_value <> r.ref_value OR c.check_value IS NULL OR r.ref_value IS NULL",
            spec(rule_type="SQL_STAT_VAL", column="", params={
                "checkSql": "SELECT COUNT(*) FROM ods_ep.ep_order",
                "refSql": "SELECT COUNT(*) FROM ods_ep.ep_order_history"})),
        "DETAIL_STAT": (
            "SELECT `PATIENT_ID`, c.check_value, r.ref_value FROM "
            "(SELECT `PATIENT_ID`, `AMOUNT` AS check_value FROM `ods_ep`.`ep_order`) c "
            "JOIN (SELECT `PID` AS `PATIENT_ID`, SUM(`PAY`) AS ref_value "
            "FROM `ods_ep`.`ep_order_item` GROUP BY `PID`) r "
            "ON c.`PATIENT_ID` = r.`PATIENT_ID` WHERE c.check_value <> r.ref_value "
            "OR c.check_value IS NULL OR r.ref_value IS NULL",
            spec(rule_type="DETAIL_STAT", column="AMOUNT", params={
                "refOp": "SUM", "refDataset": "ods_ep.ep_order_item", "refColumn": "PAY", **join})),
        "FIELD_LOGIC": (
            "SELECT `ID`, `PAY_STATUS` FROM `ods_ep`.`ep_order` "
            "WHERE NOT (`PAY_STATUS` = 'PAID' OR AMOUNT > 0)",
            spec(rule_type="FIELD_LOGIC",
                 params={"logic": "`PAY_STATUS` = 'PAID' OR AMOUNT > 0"})),
        "UPDATE_TIME": (
            "SELECT `ID`, `PAY_STATUS` FROM `ods_ep`.`ep_order` "
            "WHERE `ETL_TIME` IS NOT NULL AND `PAY_STATUS` IS NOT NULL "
            "AND TIMESTAMPDIFF(SECOND, `PAY_STATUS`, `ETL_TIME`) > 7200",
            spec(rule_type="UPDATE_TIME",
                 params={"ingestColumn": "ETL_TIME", "threshold": 2, "timeUnit": "HOUR"})),
        "TIME_CONTINUITY": (
            "SELECT prev_period, cur_period FROM (SELECT LAG(p) OVER (ORDER BY p) AS prev_period, "
            "p AS cur_period FROM (SELECT DISTINCT `PAY_STATUS` AS p FROM `ods_ep`.`ep_order` "
            "WHERE `PAY_STATUS` IS NOT NULL) d) g "
            "WHERE prev_period IS NOT NULL AND TIMESTAMPDIFF(DAY, prev_period, cur_period) > 1",
            spec(rule_type="TIME_CONTINUITY")),
    }
    for label, (expected, target) in cases.items():
        assert target.validate().compile_sql() == expected, label


def test_second_cut_derived_evidence_for_computed_shapes():
    stat = spec(rule_type="STAT_VAL_COMPARE", evidence_columns=[], params={
        "op": "COUNT", "refOp": "COUNT", "refDataset": "ods_ep.ep_order_history"})
    contract = stat.validate().evidence_contract()
    assert [item["name"] for item in contract["columns"]] == ["check_value", "ref_value"]
    detail = spec(rule_type="DETAIL_STAT", evidence_columns=[], params={
        "refOp": "SUM", "refDataset": "ods_ep.ep_order_item", "refColumn": "PAY",
        "targetJoinCols": ["PATIENT_ID"], "refJoinCols": ["PID"]})
    names = [item["name"] for item in detail.validate().evidence_contract()["columns"]]
    assert names == ["PATIENT_ID", "check_value", "ref_value"]


def test_second_cut_validation_rejects_misuse():
    join = {"targetJoinCols": ["A"], "refJoinCols": ["B", "C"]}
    with pytest.raises(ValueError, match="数量不一致"):
        spec(rule_type="CROSS_VAL_COMPARE",
             params={"refDataset": "ods_ep.patient", "refColumn": "NAME", **join}).validate()
    with pytest.raises(ValueError, match="统计函数"):
        spec(rule_type="STAT_VAL_COMPARE", params={
            "op": "MEDIAN", "refOp": "SUM", "refDataset": "a.b", "refColumn": "C"}).validate()
    with pytest.raises(ValueError, match="checkSql 与 refSql"):
        spec(rule_type="SQL_STAT_VAL", column="", params={"checkSql": "SELECT 1"}).validate()
    with pytest.raises(ValueError, match="只读"):
        spec(rule_type="SQL_STAT_VAL", column="", params={
            "checkSql": "DELETE FROM x", "refSql": "SELECT 1"}).validate()
    with pytest.raises(ValueError, match="分号或注释"):
        spec(rule_type="FIELD_LOGIC", params={"logic": "a > 1; DROP TABLE x"}).validate()
    with pytest.raises(ValueError, match="threshold"):
        spec(rule_type="UPDATE_TIME",
             params={"ingestColumn": "T", "threshold": -1, "timeUnit": "DAY"}).validate()
    with pytest.raises(ValueError, match="timeUnit"):
        spec(rule_type="UPDATE_TIME",
             params={"ingestColumn": "T", "threshold": 1, "timeUnit": "WEEK"}).validate()
    # 计算形状类型允许空证据白名单（服务端派生）；行形状仍要求非空
    with pytest.raises(ValueError, match="证据列"):
        spec(rule_type="CROSS_VAL_COMPARE", evidence_columns=[],
             params={"refDataset": "a.b", "refColumn": "C",
                     "targetJoinCols": ["A"], "refJoinCols": ["B"]}).validate()


def test_evidence_contract_matches_failure_table_shape():
    assert spec().validate().evidence_contract()["kind"] == "not_null"
    assert spec(rule_type="UNIQUE").validate().evidence_contract()["kind"] == "unique"
    assert spec(rule_type="VAL_SET", params={"values": [1]}).validate().evidence_contract()["kind"] == "accepted_values"
    fk = spec(rule_type="FK_REF", params={"refDataset": "ods_ep.ep_dict", "refColumn": "CODE"})
    assert fk.validate().evidence_contract()["kind"] == "relationships"


def test_selector_normalization_drops_unsafe_characters():
    assert selector_for("quality.dynamic.my-rule") == "dynamic_quality_dynamic_my_rule"


def test_validation_rejects_injection_and_misuse():
    with pytest.raises(ValueError, match="库.表"):
        spec(dataset_id="ods_ep;drop.ep_order").validate()
    with pytest.raises(ValueError, match="目标列"):
        spec(column="PAY_STATUS`--").validate()
    with pytest.raises(ValueError, match="只读"):
        spec(rule_type="SQL", column="",
             params={"sql": "DELETE FROM ods_ep.ep_order"}).validate()
    with pytest.raises(ValueError, match="单条"):
        spec(rule_type="SQL", column="",
             params={"sql": "SELECT 1; SELECT 2"}).validate()
    # 注释剥离后写语句同样拒绝
    with pytest.raises(ValueError, match="只读"):
        spec(rule_type="SQL", column="",
             params={"sql": "/* x */ UPDATE ods_ep.ep_order SET PAY_STATUS = 1"}).validate()
    with pytest.raises(ValueError, match="值集"):
        spec(rule_type="VAL_SET", params={"values": []}).validate()
    with pytest.raises(ValueError, match="之一"):
        spec(rule_type="VAL_MINMAX", params={}).validate()
    with pytest.raises(ValueError, match="证据列"):
        spec(evidence_columns=[]).validate()
    # SQL 注入防线：值集字符串带引号被转义
    escaped = spec(rule_type="VAL_SET", params={"values": ["a'b\\c"]}).validate().compile_sql()
    assert "'a''b\\\\c'" in escaped


@pytest.fixture()
def dynamic_client(tmp_path: Path, monkeypatch):
    from api import rules_router
    import api as api_module
    import security
    from db import SCHEMA_SQL
    from sqlalchemy import create_engine, text

    # 直通开发 principal（auth DISABLED），走与线上相同的 scope 检查路径
    monkeypatch.setattr(security, "settings", SimpleNamespace(auth_mode="DISABLED"))
    engine = create_engine("sqlite:///" + str(tmp_path / "runner.db"))
    # sqlite 的「库.表」需要 ATTACH 出 data_os 附加库，db.py 的带前缀语句才能落
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _attach_data_os(dbapi_connection, _):
        dbapi_connection.execute("ATTACH DATABASE ':memory:' AS data_os")

    with engine.begin() as connection:
        for statement in SCHEMA_SQL.split(";"):
            stripped = statement.strip()
            # sqlite 附加库不支持 CREATE SCHEMA、带库名的 CREATE INDEX、
            # ADD COLUMN IF NOT EXISTS（本测试只依赖 registry 两表的存在）
            skip = stripped.upper().startswith(("CREATE SCHEMA", "CREATE INDEX", "ALTER TABLE"))
            if stripped and not skip:
                connection.execute(text(statement))
    database = RunnerDatabase.__new__(RunnerDatabase)
    database.engine = engine

    monkeypatch.setattr(api_module, "runner_settings", SimpleNamespace(project_dir=str(tmp_path)))
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(rules_router(database))
    return TestClient(app), tmp_path, engine


def test_dynamic_rule_api_writes_sql_file_and_registry(dynamic_client):
    client, project, engine = dynamic_client
    response = client.put("/api/v1/quality/rules/dynamic/quality.dynamic.sample", json={
        "ruleId": "quality.dynamic.sample", "ruleType": "NOT_NULL",
        "datasetId": "ods_ep.ep_order", "column": "PAY_STATUS",
        "params": {}, "evidenceColumns": [
            {"name": "ID", "classification": "IDENTIFIER"},
            {"name": "PAY_STATUS", "classification": "CATEGORY"}],
    })
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["selector"] == "dynamic_quality_dynamic_sample"
    sql_file = project / "tests" / "dynamic" / "dynamic_quality_dynamic_sample.sql"
    assert sql_file.exists()
    assert "WHERE `PAY_STATUS` IS NULL" in sql_file.read_text(encoding="utf-8")

    from sqlalchemy import text
    with engine.connect() as connection:
        row = connection.execute(text(
            "SELECT selector, dataset_id, enabled FROM data_os.quality_rule_registry"
        )).mappings().first()
        assert row["selector"] == "dynamic_quality_dynamic_sample"
        assert row["dataset_id"] == "ods_ep.ep_order"
        assert row["enabled"] in (True, 1)


def test_dynamic_rule_api_disable_removes_file_and_registry_entry(dynamic_client):
    client, project, engine = dynamic_client
    client.put("/api/v1/quality/rules/dynamic/quality.dynamic.sample", json={
        "ruleId": "quality.dynamic.sample", "ruleType": "NOT_NULL",
        "datasetId": "ods_ep.ep_order", "column": "PAY_STATUS",
        "params": {}, "evidenceColumns": [{"name": "ID", "classification": "IDENTIFIER"}],
    })
    response = client.delete("/api/v1/quality/rules/dynamic/quality.dynamic.sample")
    assert response.status_code == 200
    assert not (project / "tests" / "dynamic" / "dynamic_quality_dynamic_sample.sql").exists()
    from sqlalchemy import text
    with engine.connect() as connection:
        row = connection.execute(text(
            "SELECT enabled FROM data_os.quality_rule_registry"
        )).mappings().first()
        assert row["enabled"] in (False, 0)
    # 再删一次 → 404
    assert client.delete("/api/v1/quality/rules/dynamic/quality.dynamic.sample").status_code == 404


def test_dynamic_rule_api_rejects_bad_payload(dynamic_client):
    client, _, _ = dynamic_client
    response = client.put("/api/v1/quality/rules/dynamic/quality.dynamic.sample", json={
        "ruleId": "quality.dynamic.sample", "ruleType": "SQL",
        "datasetId": "ods_ep.ep_order", "column": "",
        "params": {"sql": "DROP TABLE ods_ep.ep_order"}, "evidenceColumns": [
            {"name": "ID", "classification": "IDENTIFIER"}],
    })
    assert response.status_code == 400
    assert "只读" in response.json()["detail"]
    # ruleId 不一致
    mismatch = client.put("/api/v1/quality/rules/dynamic/other.id", json={
        "ruleId": "quality.dynamic.sample", "ruleType": "NOT_NULL",
        "datasetId": "ods_ep.ep_order", "column": "PAY_STATUS",
        "params": {}, "evidenceColumns": [{"name": "ID", "classification": "IDENTIFIER"}],
    })
    assert mismatch.status_code == 400
