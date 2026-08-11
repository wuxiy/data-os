from __future__ import annotations

import asyncio
from contextlib import suppress
import hashlib
import json
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any

from artifacts import ArtifactStore
from db import RunnerDatabase
from evidence import EvidenceReader
from models import QualityRun, RuleDefinition
from rules import RuleCatalog
from settings import Settings


_SECRET = re.compile(r"(?i)(password|secret|token|authorization)=?[^\s,;]+")


def tenant_namespace(tenant_id: str, institution_id: str) -> str:
    canonical = f"{tenant_id.strip()}|{institution_id.strip()}".encode("utf-8")
    return "t_" + hashlib.sha256(canonical).hexdigest()[:24]


def _safe_message(value: str) -> str:
    text = _SECRET.sub(r"\1=[REDACTED]", value or "")
    text = " ".join(text.split())
    return text[-1000:]


class QualityRunManager:
    def __init__(self, database: RunnerDatabase, catalog: RuleCatalog, settings: Settings):
        self.database = database
        self.catalog = catalog
        self.settings = settings
        self.evidence = EvidenceReader(settings.doris_host, settings.doris_port, settings.doris_database,
                                       settings.doris_audit_database,
                                       settings.doris_user, settings.doris_password, settings.evidence_limit,
                                       settings.doris_cleanup_user, settings.doris_cleanup_password,
                                       settings.evidence_hash_key)
        self.artifacts = ArtifactStore(settings.artifact_dir, settings.artifact_s3_endpoint,
                                       settings.artifact_s3_bucket, settings.artifact_s3_region,
                                       settings.artifact_s3_access_key, settings.artifact_s3_secret_key)
        self._global = asyncio.Semaphore(settings.max_concurrency)
        self._tenant_semaphores: dict[str, asyncio.Semaphore] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._processes: dict[str, asyncio.subprocess.Process] = {}
        self._dispatch_task: asyncio.Task[Any] | None = None
        self._maintenance_task: asyncio.Task[Any] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        await asyncio.to_thread(self.database.ensure_schema)
        await asyncio.to_thread(self.database.upsert_rules, self.catalog.all())
        await asyncio.to_thread(self.database.requeue_stale, self.settings.stale_run_seconds)
        await asyncio.to_thread(self.evidence.cleanup_registered_failure_tables,
                                [rule.selector for rule in self.catalog.all()])
        await asyncio.to_thread(self.artifacts.cleanup, self.settings.artifact_retention_days)
        self._dispatch_task = asyncio.create_task(self._dispatch_loop())
        self._maintenance_task = asyncio.create_task(self._maintenance_loop())

    async def stop(self) -> None:
        self._stop.set()
        if self._dispatch_task is not None:
            self._dispatch_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._dispatch_task
        if self._maintenance_task is not None:
            self._maintenance_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._maintenance_task
        for process in list(self._processes.values()):
            if process.returncode is None:
                process.terminate()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)

    async def submit(self, payload: dict[str, Any]) -> QualityRun:
        rule = self.catalog.get(payload["rule_id"])
        if rule is None:
            raise ValueError("registered ruleId not found")
        return await asyncio.to_thread(self.database.create_or_get_run, payload, rule)

    async def get(self, run_id: str) -> QualityRun:
        return await asyncio.to_thread(self.database.get_run, run_id)

    async def cancel(self, run_id: str) -> bool:
        process = self._processes.get(run_id)
        changed = await asyncio.to_thread(self.database.cancel, run_id)
        if process is not None and process.returncode is None:
            process.terminate()
        return changed

    def _tenant_semaphore(self, tenant_id: str) -> asyncio.Semaphore:
        return self._tenant_semaphores.setdefault(
            tenant_id, asyncio.Semaphore(self.settings.max_concurrency_per_tenant)
        )

    async def _dispatch_loop(self) -> None:
        while not self._stop.is_set():
            try:
                # Claim no more work than the executor can run. This keeps
                # QUEUED/RUNNING state aligned across a restart and avoids an
                # unbounded collection of tasks waiting on semaphores.
                if len(self._tasks) >= self.settings.max_concurrency:
                    await asyncio.sleep(0.1)
                    continue
                run = await asyncio.to_thread(self.database.claim_next)
                if run is None:
                    await asyncio.sleep(0.5)
                    continue
                task = asyncio.create_task(self._execute(run))
                self._tasks[run.run_id] = task
                task.add_done_callback(lambda _, run_id=run.run_id: self._tasks.pop(run_id, None))
            except Exception:
                await asyncio.sleep(1)

    async def _execute(self, run: QualityRun) -> None:
        async with self._global, self._tenant_semaphore(run.tenant_id):
            # Cancellation may win the race between queue claim and task
            # startup. Do not launch dbt for a row already marked terminal.
            current = await asyncio.to_thread(self.database.get_run, run.run_id)
            if current.status != "RUNNING":
                return
            rule = self.catalog.get(run.rule_id)
            if rule is None:
                await asyncio.to_thread(self.database.finish, run.run_id, "FAILED", False,
                                        "规则注册已不存在", [], None)
                return
            directory = Path(tempfile.mkdtemp(prefix=f"dataos-quality-{run.run_id}-"))
            try:
                result = await self._run_dbt(run, rule, directory)
                await asyncio.to_thread(self.database.finish, run.run_id, result["status"], result["passed"],
                                        result["message"], result["evidence"], result["artifact_uri"])
            except asyncio.CancelledError:
                await asyncio.to_thread(self.database.finish, run.run_id, "CANCELED", False, "执行已取消", [], None)
                raise
            except Exception as exc:
                await asyncio.to_thread(self.database.finish, run.run_id, "FAILED", False, _safe_message(str(exc)), [], None)
            finally:
                shutil.rmtree(directory, ignore_errors=True)

    async def _run_dbt(self, run: QualityRun, rule: RuleDefinition, directory: Path) -> dict[str, Any]:
        target_path = directory / "target"
        target_path.mkdir(parents=True, exist_ok=True)
        stdout_path = directory / "stdout.log"
        stderr_path = directory / "stderr.log"
        command = [
            self.settings.dbt_binary, "test", "--select", rule.selector,
            "--project-dir", self.settings.project_dir, "--profiles-dir", self.settings.profiles_dir,
            "--target", self.settings.target, "--target-path", str(target_path),
            "--no-use-colors", "--store-failures",
        ]
        env = os.environ.copy()
        env["DBT_PROFILES_DIR"] = self.settings.profiles_dir
        namespace = tenant_namespace(run.tenant_id, run.institution_id)
        env["DATAOS_TEST_NAMESPACE"] = namespace
        process: asyncio.subprocess.Process | None = None
        heartbeat_task: asyncio.Task[Any] | None = None
        stdout = b""
        stderr = b""
        try:
            process = await asyncio.create_subprocess_exec(
                *command, cwd=self.settings.project_dir, env=env,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            self._processes[run.run_id] = process
            heartbeat_task = asyncio.create_task(self._heartbeat_loop(run.run_id))
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), self.settings.timeout_seconds)
            except asyncio.TimeoutError:
                process.kill()
                stdout, stderr = await process.communicate()
                return {"status": "FAILED", "passed": False, "message": "dbt 执行超过配置的超时时间",
                        "evidence": [], "artifact_uri": None}
            except asyncio.CancelledError:
                # A manager shutdown or explicit cancellation must not leave a
                # detached dbt process mutating failure tables after the run
                # has already been marked CANCELED.
                if process.returncode is None:
                    process.terminate()
                    with suppress(ProcessLookupError):
                        await process.communicate()
                raise
            stdout_path.write_bytes(stdout[-64_000:])
            stderr_path.write_bytes(stderr[-64_000:])
            results_path = target_path / "run_results.json"
            summary = self._parse_results(results_path, process.returncode, stdout, stderr)
            if not summary["passed"]:
                summary["evidence"] = self.evidence.read(rule.evidence, namespace)
            summary["artifact_uri"] = self.artifacts.store(namespace, run.run_id, {
                "runId": run.run_id, "ruleId": rule.rule_id, "selector": rule.selector,
                "status": summary["status"], "passed": summary["passed"], "message": summary["message"],
                "evidenceCount": len(summary["evidence"]),
            })
            return summary
        finally:
            if heartbeat_task is not None:
                heartbeat_task.cancel()
                with suppress(asyncio.CancelledError):
                    await heartbeat_task
            self._processes.pop(run.run_id, None)
            # dbt --store-failures is useful only until evidence is captured.
            # This finally block also runs for timeout, cancellation and dbt
            # startup failures, preventing audit-table residue.
            self.evidence.cleanup_failure_tables(rule.selector, namespace)

    async def _heartbeat_loop(self, run_id: str) -> None:
        interval = max(5, min(60, self.settings.stale_run_seconds // 3))
        while not self._stop.is_set():
            await asyncio.sleep(interval)
            try:
                await asyncio.to_thread(self.database.heartbeat, run_id)
            except Exception:
                # A transient database outage should not kill the dbt process;
                # startup requeue remains the recovery authority.
                continue

    async def _maintenance_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.sleep(3600)
                await asyncio.to_thread(self.evidence.cleanup_registered_failure_tables,
                                        [rule.selector for rule in self.catalog.all()])
                await asyncio.to_thread(self.artifacts.cleanup, self.settings.artifact_retention_days)
            except asyncio.CancelledError:
                raise
            except Exception:
                # A maintenance outage must not stop execution; the next
                # interval retries cleanup and the startup pass is idempotent.
                continue

    def _parse_results(self, path: Path, returncode: int, stdout: bytes, stderr: bytes) -> dict[str, Any]:
        message = _safe_message((stderr or stdout).decode("utf-8", errors="replace"))
        statuses: list[str] = []
        if path.exists():
            try:
                document = json.loads(path.read_text(encoding="utf-8"))
                statuses = [str(item.get("status", "")).lower() for item in document.get("results", [])]
            except (OSError, ValueError) as exc:
                message = _safe_message(f"无法解析 dbt run_results.json：{exc}; {message}")
        passed = bool(statuses) and all(item in {"pass", "warn"} for item in statuses) and returncode == 0
        status = "SUCCEEDED" if passed else "FAILED"
        if not statuses and returncode != 0:
            message = message or "dbt 执行失败"
        elif not message:
            message = "dbt 质量规则通过" if passed else "dbt 质量规则未通过"
        return {"status": status, "passed": passed, "message": message,
                "evidence": [], "artifact_uri": None}
