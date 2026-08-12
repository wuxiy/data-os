from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
from typing import Any

from db import RunnerDatabase, utcnow
from artifacts import ArtifactStore
from runner import tenant_namespace


class _FakeResult:
    def __init__(self, row: dict[str, Any] | None = None, rowcount: int = 0):
        self._row = deepcopy(row) if row is not None else None
        self.rowcount = rowcount

    def mappings(self) -> "_FakeResult":
        return self

    def first(self) -> dict[str, Any] | None:
        return deepcopy(self._row)


class _FakeConnection:
    def __init__(self, rows: dict[str, dict[str, Any]]):
        self.rows = rows

    def execute(self, statement: Any, params: dict[str, Any] | None = None) -> _FakeResult:
        sql = " ".join(statement.text.split()).lower()
        values = params or {}

        if sql.startswith("select * from data_os.quality_runner_runs"):
            if "where run_id = :run_id and status = 'queued'" in sql:
                row = self.rows.get(values["run_id"])
                if row is None or row["status"] != "QUEUED":
                    return _FakeResult()
                return _FakeResult(row)
            if "where status = 'queued'" in sql:
                candidates = [row for row in self.rows.values() if row["status"] == "QUEUED"]
                return _FakeResult(min(candidates, key=lambda row: row["created_at"]) if candidates else None)
            if "where run_id = :run_id" in sql:
                return _FakeResult(self.rows.get(values["run_id"]))

        if "set status = 'running'" in sql:
            row = self.rows[values["run_id"]]
            row.update({
                "status": "RUNNING",
                "execution_generation": row["execution_generation"] + 1,
                "started_at": row["started_at"] or utcnow(),
                "heartbeat_at": utcnow(),
                "updated_at": utcnow(),
            })
            return _FakeResult(rowcount=1)

        if "set heartbeat_at = current_timestamp" in sql:
            row = self.rows[values["run_id"]]
            if row["status"] != "RUNNING" or row["execution_generation"] != values["execution_generation"]:
                return _FakeResult(rowcount=0)
            row.update({"heartbeat_at": utcnow(), "updated_at": utcnow()})
            return _FakeResult(rowcount=1)

        if sql.startswith("select 1 from data_os.quality_runner_runs"):
            row = self.rows.get(values["run_id"])
            if row is None or row["status"] != "RUNNING" or row["execution_generation"] != values["execution_generation"]:
                return _FakeResult()
            return _FakeResult({"?column?": 1})

        if "set status = :status" in sql:
            row = self.rows[values["run_id"]]
            if row["status"] != "RUNNING" or row["execution_generation"] != values["execution_generation"]:
                return _FakeResult(rowcount=0)
            row.update({
                "status": values["status"],
                "passed": values["passed"],
                "message": values["message"],
                "sample_evidence_json": values["evidence"],
                "artifact_uri": values["artifact_uri"],
                "finished_at": utcnow(),
                "heartbeat_at": None,
                "updated_at": utcnow(),
            })
            return _FakeResult(rowcount=1)

        if "set status = 'queued'" in sql:
            changed = 0
            for row in self.rows.values():
                stale_at = utcnow() - timedelta(seconds=values["seconds"])
                if row["status"] == "RUNNING" and (
                    row["heartbeat_at"] is None or row["heartbeat_at"] < stale_at
                ):
                    row.update({
                        "status": "QUEUED",
                        "execution_generation": row["execution_generation"] + 1,
                        "message": "Runtime 重启后恢复排队",
                        "heartbeat_at": None,
                        "updated_at": utcnow(),
                    })
                    changed += 1
            return _FakeResult(rowcount=changed)

        raise AssertionError(f"Unhandled SQL in test connection: {statement.text}")


class _FakeEngine:
    def __init__(self, rows: dict[str, dict[str, Any]]):
        self.connection = _FakeConnection(rows)

    def begin(self) -> "_FakeEngine":
        return self

    def connect(self) -> "_FakeEngine":
        return self

    def __enter__(self) -> _FakeConnection:
        return self.connection

    def __exit__(self, *_: Any) -> None:
        return None


def _database() -> RunnerDatabase:
    now = utcnow()
    rows = {
        "run-1": {
            "run_id": "run-1",
            "issue_id": "issue-1",
            "tenant_id": "tenant-1",
            "institution_id": "institution-1",
            "rule_id": "rule-1",
            "dataset_id": "dataset-1",
            "execution_batch_id": "run-1",
            "idempotency_key": "key-1",
            "status": "QUEUED",
            "passed": None,
            "message": "质量规则已排队",
            "sample_evidence_json": "[]",
            "artifact_uri": None,
            "started_at": None,
            "finished_at": None,
            "heartbeat_at": None,
            "execution_generation": 0,
            "created_at": now,
            "updated_at": now,
        }
    }
    database = RunnerDatabase.__new__(RunnerDatabase)
    database.engine = _FakeEngine(rows)
    return database


def _finish(database: RunnerDatabase, generation: int, artifact_uri: str | None = None) -> bool:
    return database.finish(
        "run-1", generation, "SUCCEEDED", True, "规则通过", [], artifact_uri
    )


def test_claim_and_stale_requeue_assign_new_execution_generations():
    database = _database()

    first = database.claim_next("run-1")
    assert first is not None
    assert first.execution_generation == 1

    database.engine.connection.rows["run-1"]["heartbeat_at"] = utcnow() - timedelta(seconds=60)
    assert database.requeue_stale(30) == 1
    queued = database.get_run("run-1")
    assert queued.status == "QUEUED"
    assert queued.execution_generation == 2

    second = database.claim_next("run-1")
    assert second is not None
    assert second.execution_generation == 3
    assert second.execution_generation != first.execution_generation


def test_old_generation_heartbeat_and_finish_are_rejected_after_requeue():
    database = _database()
    first = database.claim_next("run-1")
    assert first is not None

    database.engine.connection.rows["run-1"]["heartbeat_at"] = utcnow() - timedelta(seconds=60)
    database.requeue_stale(30)
    second = database.claim_next("run-1")
    assert second is not None

    assert database.heartbeat("run-1", first.execution_generation) is False
    assert _finish(database, first.execution_generation, "old-artifact") is False

    current = database.get_run("run-1")
    assert current.status == "RUNNING"
    assert current.execution_generation == second.execution_generation
    assert current.artifact_uri is None

    assert database.owns_generation("run-1", first.execution_generation) is False
    assert database.owns_generation("run-1", second.execution_generation) is True


def test_current_generation_can_heartbeat_and_finish_with_artifact_result():
    database = _database()
    claimed = database.claim_next("run-1")
    assert claimed is not None

    assert database.heartbeat("run-1", claimed.execution_generation) is True
    assert _finish(database, claimed.execution_generation, "artifact://current") is True

    finished = database.get_run("run-1")
    assert finished.status == "SUCCEEDED"
    assert finished.passed is True
    assert finished.artifact_uri == "artifact://current"


def test_generation_scopes_external_artifacts_and_failure_tables(tmp_path):
    namespace_one = tenant_namespace("tenant-1", "institution-1", 1)
    namespace_two = tenant_namespace("tenant-1", "institution-1", 2)
    assert namespace_one != namespace_two

    store = ArtifactStore(str(tmp_path), "", "", "", "", "")
    first_path = store.store(namespace_one, "run-1", {"generation": 1}, 1)
    second_path = store.store(namespace_two, "run-1", {"generation": 2}, 2)

    assert first_path != second_path
    assert "generation-1" in first_path
    assert "generation-2" in second_path
