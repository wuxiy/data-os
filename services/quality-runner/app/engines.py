from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from db import RunnerDatabase
from evidence import EvidenceReader
from models import QualityRun, RuleDefinition
from supervisor import ProcessOutcome, ProcessSupervisor


_SECRET = re.compile(r"(?i)(password|secret|token|authorization)=?[^\s,;]+")


def safe_message(value: str) -> str:
    text = _SECRET.sub(r"\1=[REDACTED]", value or "")
    text = " ".join(text.split())
    return text[-1000:]


@dataclass
class EngineResult:
    """单次引擎执行的结论。artifact_payload 为 None 表示不落产物
    （超时、执行代次已失效等）。"""

    status: str
    passed: bool
    message: str
    evidence: list[dict[str, Any]] = field(default_factory=list)
    artifact_payload: dict[str, Any] | None = None


class RuleEngine(Protocol):
    """质量引擎（领域定义见 CONTEXT.md）：以特定技术执行一条质量规则。
    执行器按规则把运行交给引擎；引擎负责命令构造、结果解析与自身
    产物清理，进程监督与代次围栏由共享的 ProcessSupervisor 承担。"""

    async def execute(self, run: QualityRun, rule: RuleDefinition,
                      workdir: Path, namespace: str) -> EngineResult: ...

    def maintenance(self) -> None:
        """周期性清理（dbt：清各命名空间残留的失败表）。"""
        ...


class DbtEngine:
    """以 dbt test 执行质量规则的引擎：selector 路由、run_results.json
    解析、失败样本读取与失败表清理都是 dbt 专属知识，收在引擎内。"""

    def __init__(self, settings: Any, evidence: EvidenceReader,
                 supervisor: ProcessSupervisor, database: RunnerDatabase,
                 catalog: Any):
        self.settings = settings
        self.evidence = evidence
        self.supervisor = supervisor
        self.database = database
        self.catalog = catalog

    async def execute(self, run: QualityRun, rule: RuleDefinition,
                      workdir: Path, namespace: str) -> EngineResult:
        target_path = workdir / "target"
        target_path.mkdir(parents=True, exist_ok=True)
        command = [
            self.settings.dbt_binary, "test", "--select", rule.selector,
            "--project-dir", self.settings.project_dir, "--profiles-dir", self.settings.profiles_dir,
            "--target", self.settings.target, "--target-path", str(target_path),
            "--no-use-colors", "--store-failures",
        ]
        env = os.environ.copy()
        env["DBT_PROFILES_DIR"] = self.settings.profiles_dir
        env["DATAOS_TEST_NAMESPACE"] = namespace
        try:
            outcome = await self.supervisor.run(
                run_id=run.run_id, execution_generation=run.execution_generation,
                command=command, cwd=self.settings.project_dir, env=env,
                timeout=self.settings.timeout_seconds,
            )
            (workdir / "stdout.log").write_bytes(outcome.stdout[-64_000:])
            (workdir / "stderr.log").write_bytes(outcome.stderr[-64_000:])
            if outcome.timed_out:
                summary = {"status": "FAILED", "passed": False,
                           "message": "dbt 执行超过配置的超时时间", "evidence": []}
                return EngineResult(summary["status"], False, summary["message"])
            summary = self.parse_results(target_path / "run_results.json", outcome.returncode,
                                         outcome.stdout, outcome.stderr)
            if not summary["passed"]:
                summary["evidence"] = await asyncio.to_thread(
                    self.evidence.read, rule.evidence, namespace)
            if not await asyncio.to_thread(self.database.owns_generation,
                                           run.run_id, run.execution_generation):
                return EngineResult("CANCELED", False, "执行代次已失效")
            payload = {
                "runId": run.run_id, "ruleId": rule.rule_id, "selector": rule.selector,
                "status": summary["status"], "passed": summary["passed"], "message": summary["message"],
                "evidenceCount": len(summary["evidence"]),
            }
            return EngineResult(summary["status"], summary["passed"], summary["message"],
                                summary["evidence"], payload)
        finally:
            # dbt --store-failures is useful only until evidence is captured.
            # This finally block also runs for timeout, cancellation and dbt
            # startup failures, preventing audit-table residue.
            await asyncio.to_thread(self.evidence.cleanup_failure_tables, rule.selector, namespace)

    def maintenance(self) -> None:
        self.evidence.cleanup_registered_failure_tables(
            [rule.selector for rule in self.catalog.all()])

    def parse_results(self, path: Path, returncode: int | None,
                      stdout: bytes, stderr: bytes) -> dict[str, Any]:
        message = safe_message((stderr or stdout).decode("utf-8", errors="replace"))
        statuses: list[str] = []
        if path.exists():
            try:
                document = json.loads(path.read_text(encoding="utf-8"))
                statuses = [str(item.get("status", "")).lower() for item in document.get("results", [])]
            except (OSError, ValueError) as exc:
                message = safe_message(f"无法解析 dbt run_results.json：{exc}; {message}")
        passed = bool(statuses) and all(item in {"pass", "warn"} for item in statuses) and returncode == 0
        status = "SUCCEEDED" if passed else "FAILED"
        if not statuses and returncode != 0:
            message = message or "dbt 执行失败"
        elif not message:
            message = "dbt 质量规则通过" if passed else "dbt 质量规则未通过"
        return {"status": status, "passed": passed, "message": message,
                "evidence": [], "artifact_uri": None}
