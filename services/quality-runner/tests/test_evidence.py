from evidence import EvidenceReader, _mask
from sqlalchemy import create_engine, text


def test_sensitive_evidence_is_hashed():
    assert _mask("patient_id", "P001").startswith("sha256:")
    assert _mask("status", "VALID") == "VALID"


def test_unlisted_fields_are_redacted_and_identifiers_use_hmac():
    assert _mask("diagnosis_text", "should not be copied", "REDACTED", "tenant-key-123456") == "[REDACTED]"
    assert _mask("patient_id", "P001", "IDENTIFIER", "tenant-key-123456").startswith("hmac-sha256:")


def _reader(limit: int = 20) -> EvidenceReader:
    # 起一个真实构造（enabled=True）再换 sqlite 引擎：read 路径的 SQL
    # 与掩码管线不需要真 Doris。
    reader = EvidenceReader("doris-fe", 9030, "dataos_quality_audit",
                            "query-user", "query-pass", limit)
    reader.engine = create_engine("sqlite://")
    return reader


def test_not_null_reads_row_shaped_failure_table():
    reader = _reader()
    with reader.engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE t_ns__sel_row (record_id TEXT, patient_id TEXT, status TEXT)"))
        connection.execute(text(
            "INSERT INTO t_ns__sel_row VALUES ('r1', NULL, 'VALID'), ('r2', NULL, 'CANCELLED')"))
    evidence = {"kind": "not_null", "column": "patient_id",
                "columns": [{"name": "record_id", "classification": "IDENTIFIER"},
                            {"name": "patient_id", "classification": "IDENTIFIER"},
                            {"name": "status", "classification": "CATEGORY"}]}
    rows = reader.read("sel_row", evidence, "t_ns")
    assert [row["status"] for row in rows] == ["VALID", "CANCELLED"]
    assert rows[0]["record_id"].startswith("sha256:")


def test_unique_reads_aggregate_failure_table():
    reader = _reader()
    with reader.engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE t_h__sel_dup (unique_field TEXT, n_records INT)"))
        connection.execute(text("INSERT INTO t_h__sel_dup VALUES ('r1', 3), ('r2', 2)"))
    evidence = {"kind": "unique", "column": "record_id",
                "columns": [{"name": "record_id", "classification": "IDENTIFIER"}]}
    rows = reader.read("sel_dup", evidence, "t_h")
    # 聚合形状投影为「被测列 + 出现次数」，值列按其策略脱敏。
    assert rows[0]["record_id"].startswith("sha256:")
    assert rows[0]["n_records"] == "3"


def test_relationships_reads_orphan_values():
    reader = _reader()
    with reader.engine.begin() as connection:
        connection.execute(text("CREATE TABLE t_h__sel_fk (from_field TEXT)"))
        connection.execute(text("INSERT INTO t_h__sel_fk VALUES ('CFZ-9'), ('CFZ-404')"))
    evidence = {"kind": "relationships", "column": "CFZID",
                "columns": [{"name": "CFZID", "classification": "IDENTIFIER"}]}
    rows = reader.read("sel_fk", evidence, "t_h")
    assert len(rows) == 2
    assert all(row["CFZID"].startswith("sha256:") for row in rows)


def test_missing_failure_table_yields_empty_evidence():
    reader = _reader()
    evidence = {"kind": "not_null", "column": "c",
                "columns": [{"name": "c", "classification": "SAFE"}]}
    # dbt 测试自身 error（非数据失败）时没有失败表：证据留空、不上抛。
    assert reader.read("sel_absent", evidence, "t_ns") == []


def test_evidence_limit_caps_rows():
    reader = _reader(limit=1)
    with reader.engine.begin() as connection:
        connection.execute(text("CREATE TABLE t_h__sel_cap (from_field TEXT)"))
        connection.execute(text("INSERT INTO t_h__sel_cap VALUES ('a'), ('b')"))
    evidence = {"kind": "relationships", "column": "CFZID",
                "columns": [{"name": "CFZID", "classification": "IDENTIFIER"}]}
    assert len(reader.read("sel_cap", evidence, "t_h")) == 1
