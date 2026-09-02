from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from engines import DbtEngine, EngineResult, safe_message
from models import QualityRun, RuleDefinition
from runner import QualityRunManager, tenant_namespace
from settings import Settings
from supervisor import ProcessOutcome


RULE = RuleDefinition(rule_id="r1", selector="sel_a", dataset_id="d1",
                      evidence={"kind": "not_null", "column": "c", "columns": ["c"]})


def make_run(status: str = "RUNNING", generation: int = 3) -> QualityRun:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    return QualityRun(run_id="run-1", issue_id="i", tenant_id="t", institution_id="h",
                      rule_id="r1", dataset_id="d1", execution_batch_id="b", idempotency_key="k",
                      status=status, passed=None, message="", sample_evidence=[], artifact_uri=None,
                      started_at=now, finished_at=None, created_at=now, execution_generation=generation)


class FakeCatalog:
    def __init__(self, rule: RuleDefinition | None = RULE):
        self.rule = rule

    def get(self, rule_id: str) -> RuleDefinition | None:
        return self.rule if self.rule is not None and rule_id == self.rule.rule_id else None

    def all(self) -> list[RuleDefinition]:
        return [self.rule] if self.rule else []


class FakeDatabase:
    def __init__(self, owns: bool = True, finish_accepted: bool = True):
        self.owns = owns
        self.finish_accepted = finish_accepted
        self.finish_calls: list[tuple[Any, ...]] = []

    def get_run(self, run_id: str) -> QualityRun:
        return self._current

    def finish(self, run_id, generation, status, passed, message, evidence, artifact_uri) -> bool:
        self.finish_calls.append((status, passed, message, evidence, artifact_uri))
        return self.finish_accepted

    def owns_generation(self, run_id: str, generation: int) -> bool:
        return self.owns

    def heartbeat(self, run_id: str, generation: int) -> bool:
        return self.owns


class FakeArtifacts:
    def __init__(self):
        self.stored: list[tuple[str, str, dict, int]] = []
        self.deleted: list[str] = []

    def store(self, namespace, run_id, payload, generation) -> str:
        uri = f"artifact://{run_id}"
        self.stored.append((namespace, run_id, payload, generation))
        return uri

    def delete(self, uri: str) -> None:
        self.deleted.append(uri)

    def cleanup(self, days: int) -> None:
        pass


class FakeEvidence:
    def __init__(self, rows: list[dict[str, Any]] | None = None):
        self.rows = rows or [{"sample": 1}]
        self.reads: list[tuple[str, dict, str]] = []
        self.cleanups: list[tuple[str, str]] = []

    def read(self, selector: str, evidence: dict, namespace: str = "") -> list[dict[str, Any]]:
        self.reads.append((selector, evidence, namespace))
        return self.rows

    def cleanup_failure_tables(self, selector: str, namespace: str = "") -> int:
        self.cleanups.append((selector, namespace))
        return 0

    def cleanup_registered_failure_tables(self, selectors: list[str]) -> int:
        return 0


class FakeSupervisor:
    def __init__(self, outcome: ProcessOutcome):
        self.outcome = outcome
        self.calls: list[dict[str, Any]] = []
        self.terminated: list[str] = []

    async def run(self, *, run_id, execution_generation, command, cwd, env, timeout) -> ProcessOutcome:
        self.calls.append({"run_id": run_id, "command": command, "cwd": cwd, "env": env,
                           "timeout": timeout, "generation": execution_generation})
        return self.outcome

    def terminate(self, run_id: str) -> None:
        self.terminated.append(run_id)

    async def shutdown(self) -> None:
        return None


class ScriptedEngine:
    def __init__(self, result: EngineResult | None = None, error: Exception | None = None):
        self.result = result or EngineResult("SUCCEEDED", True, "通过", [], {"runId": "run-1"})
        self.error = error
        self.executed: list[tuple[QualityRun, Path, str]] = []

    async def execute(self, run, rule, workdir, namespace) -> EngineResult:
        self.executed.append((run, workdir, namespace))
        if self.error is not None:
            raise self.error
        return self.result

    def maintenance(self) -> None:
        pass


# ---- DbtEngine ----

def test_dbt_engine_builds_namespaced_command_and_parses_pass(tmp_path: Path) -> None:
    supervisor = FakeSupervisor(ProcessOutcome(b"", b"", 0, False))
    evidence = FakeEvidence()
    engine = DbtEngine(Settings(), evidence, supervisor, FakeCatalog())
    target = tmp_path / "target"
    target.mkdir()
    (target / "run_results.json").write_text(json.dumps({"results": [{"status": "pass"}]}), encoding="utf-8")

    result = asyncio.run(engine.execute(make_run(), RULE, tmp_path, "ns-1"))

    assert result.status == "SUCCEEDED" and result.passed
    assert result.artifact_payload is not None
    assert result.artifact_payload["selector"] == "sel_a"
    call = supervisor.calls[0]
    assert "--store-failures" in call["command"]
    assert "sel_a" in call["command"]
    assert call["env"]["DATAOS_TEST_NAMESPACE"] == "ns-1"
    assert evidence.reads == []  # 通过时不读取证据
    assert evidence.cleanups == [("sel_a", "ns-1")]
    assert (tmp_path / "stdout.log").exists()


def test_dbt_engine_reads_evidence_when_failed(tmp_path: Path) -> None:
    supervisor = FakeSupervisor(ProcessOutcome(b"", b"err", 1, False))
    evidence = FakeEvidence()
    engine = DbtEngine(Settings(), evidence, supervisor, FakeCatalog())
    target = tmp_path / "target"
    target.mkdir()
    (target / "run_results.json").write_text(json.dumps({"results": [{"status": "fail"}]}), encoding="utf-8")

    result = asyncio.run(engine.execute(make_run(), RULE, tmp_path, "ns-2"))

    assert result.status == "FAILED" and not result.passed
    assert evidence.reads == [("sel_a", RULE.evidence, "ns-2")]
    assert result.evidence == [{"sample": 1}]


def test_dbt_engine_timeout_skips_evidence_and_artifact(tmp_path: Path) -> None:
    supervisor = FakeSupervisor(ProcessOutcome(b"", b"", None, True))
    evidence = FakeEvidence()
    engine = DbtEngine(Settings(), evidence, supervisor, FakeCatalog())

    result = asyncio.run(engine.execute(make_run(), RULE, tmp_path, "ns-3"))

    assert (result.status, result.passed, result.artifact_payload) == ("FAILED", False, None)
    assert "超时" in result.message
    assert evidence.reads == []
    assert evidence.cleanups == [("sel_a", "ns-3")]


def test_parse_results_variants(tmp_path: Path) -> None:
    engine = DbtEngine(Settings(), FakeEvidence(), FakeSupervisor(ProcessOutcome(b"", b"", 0, False)),
                       FakeCatalog())
    path = tmp_path / "run_results.json"
    path.write_text(json.dumps({"results": [{"status": "pass"}, {"status": "warn"}]}), encoding="utf-8")
    assert engine.parse_results(path, 0, b"", b"").status == "SUCCEEDED"
    assert engine.parse_results(path, 2, b"", b"").status == "FAILED"
    missing = engine.parse_results(tmp_path / "absent.json", 1, b"stdout", b"")
    assert missing.status == "FAILED" and missing.message == "stdout"


def test_safe_message_redacts_secrets() -> None:
    assert "password=[REDACTED]" in safe_message("login password=hunter2 failed")


# ---- QualityRunManager（经引擎 interface） ----

async def test_manager_executes_engine_and_commits_artifact() -> None:
    database = FakeDatabase()
    database._current = make_run()
    artifacts = FakeArtifacts()
    engine = ScriptedEngine()
    manager = QualityRunManager(database, FakeCatalog(), Settings(), engine=engine,
                                supervisor=FakeSupervisor(ProcessOutcome(b"", b"", 0, False)),
                                artifacts=artifacts)

    await manager._execute(make_run())

    assert len(database.finish_calls) == 1
    status, passed, message, evidence, artifact_uri = database.finish_calls[0]
    assert (status, passed) == ("SUCCEEDED", True)
    assert artifact_uri == "artifact://run-1"
    assert artifacts.stored and not artifacts.deleted
    assert engine.executed[0][2] == tenant_namespace("t", "h", 3)


async def test_manager_deletes_artifact_when_generation_stale() -> None:
    database = FakeDatabase(owns=False)
    database._current = make_run()
    artifacts = FakeArtifacts()
    engine = ScriptedEngine()
    manager = QualityRunManager(database, FakeCatalog(), Settings(), engine=engine,
                                supervisor=FakeSupervisor(ProcessOutcome(b"", b"", 0, False)),
                                artifacts=artifacts)

    await manager._execute(make_run())

    status, _, _, _, artifact_uri = database.finish_calls[0]
    assert artifact_uri is None
    assert artifacts.deleted == ["artifact://run-1"]


async def test_manager_records_failed_run_with_safe_message_on_engine_error() -> None:
    database = FakeDatabase()
    database._current = make_run()
    manager = QualityRunManager(database, FakeCatalog(), Settings(),
                                engine=ScriptedEngine(error=ValueError("boom password=secret1")),
                                supervisor=FakeSupervisor(ProcessOutcome(b"", b"", 0, False)),
                                artifacts=FakeArtifacts())

    await manager._execute(make_run())

    status, passed, message, _, artifact_uri = database.finish_calls[0]
    assert (status, passed) == ("FAILED", False)
    assert "password=[REDACTED]" in message


async def test_manager_skips_artifact_when_engine_returns_none_payload() -> None:
    database = FakeDatabase()
    database._current = make_run()
    artifacts = FakeArtifacts()
    manager = QualityRunManager(database, FakeCatalog(), Settings(),
                                engine=ScriptedEngine(result=EngineResult("FAILED", False, "超时")),
                                supervisor=FakeSupervisor(ProcessOutcome(b"", b"", 0, False)),
                                artifacts=artifacts)

    await manager._execute(make_run())

    status, _, _, _, artifact_uri = database.finish_calls[0]
    assert status == "FAILED" and artifact_uri is None
    assert artifacts.stored == []


async def test_manager_deletes_artifact_when_finish_rejected() -> None:
    database = FakeDatabase(finish_accepted=False)
    database._current = make_run()
    artifacts = FakeArtifacts()
    manager = QualityRunManager(database, FakeCatalog(), Settings(), engine=ScriptedEngine(),
                                supervisor=FakeSupervisor(ProcessOutcome(b"", b"", 0, False)),
                                artifacts=artifacts)

    await manager._execute(make_run())

    assert artifacts.deleted == ["artifact://run-1"]


async def test_manager_does_not_launch_engine_for_cancelled_claim() -> None:
    database = FakeDatabase()
    database._current = make_run(status="CANCELED")
    engine = ScriptedEngine()
    manager = QualityRunManager(database, FakeCatalog(), Settings(), engine=engine,
                                supervisor=FakeSupervisor(ProcessOutcome(b"", b"", 0, False)),
                                artifacts=FakeArtifacts())

    await manager._execute(make_run())

    assert engine.executed == []
    assert database.finish_calls == []


def test_tenant_namespace_includes_generation() -> None:
    assert tenant_namespace("t", "h", 1) != tenant_namespace("t", "h", 2)
