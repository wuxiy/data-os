from __future__ import annotations

import asyncio
import hashlib
import shutil
import tempfile
from contextlib import suppress
from pathlib import Path
from typing import Any

from artifacts import ArtifactStore
from db import RunnerDatabase
from engines import DbtEngine, RuleEngine, safe_message
from evidence import EvidenceReader
from models import QualityRun
from rules import RuleCatalog
from settings import Settings
from supervisor import ProcessSupervisor


def tenant_namespace(tenant_id: str, institution_id: str, execution_generation: int | None = None) -> str:
    generation = "" if execution_generation is None else f"|generation:{execution_generation}"
    canonical = f"{tenant_id.strip()}|{institution_id.strip()}{generation}".encode("utf-8")
    # Doris limits table names to 64 characters. Registered dbt failure
    # tables use ``<namespace>__<selector>``; keeping 18 hash characters
    # leaves room for the longest bundled selector while retaining an
    # 72-bit tenant/institution namespace.
    return "t_" + hashlib.sha256(canonical).hexdigest()[:18]


class QualityRunManager:
    """质量执行器的编排：队列领取、并发闸、执行代次围栏与产物提交。
    规则如何被执行属于质量引擎（默认 dbt），进程监督在
    ProcessSupervisor——两者都可注入替换。"""

    def __init__(self, database: RunnerDatabase, catalog: RuleCatalog, settings: Settings,
                 engine: RuleEngine | None = None, supervisor: ProcessSupervisor | None = None,
                 artifacts: ArtifactStore | None = None):
        self.database = database
        self.catalog = catalog
        self.settings = settings
        self.supervisor = supervisor or ProcessSupervisor(database, settings.stale_run_seconds)
        self.engine = engine or DbtEngine(settings, EvidenceReader(
            settings.doris_host, settings.doris_port, settings.doris_audit_database,
            settings.doris_user, settings.doris_password, settings.evidence_limit,
            settings.doris_cleanup_user, settings.doris_cleanup_password,
            settings.evidence_hash_key,
        ), self.supervisor, database, catalog)
        self.artifacts = artifacts or ArtifactStore(settings.artifact_dir, settings.artifact_s3_endpoint,
                                                    settings.artifact_s3_bucket, settings.artifact_s3_region,
                                                    settings.artifact_s3_access_key, settings.artifact_s3_secret_key)
        self._global = asyncio.Semaphore(settings.max_concurrency)
        self._tenant_semaphores: dict[str, asyncio.Semaphore] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._dispatch_task: asyncio.Task[Any] | None = None
        self._maintenance_task: asyncio.Task[Any] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        await asyncio.to_thread(self.database.ensure_schema)
        await asyncio.to_thread(self.database.upsert_rules, self.catalog.all())
        await asyncio.to_thread(self.database.requeue_stale, self.settings.stale_run_seconds)
        await asyncio.to_thread(self.engine.maintenance)
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
        await self.supervisor.shutdown()
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
        self.supervisor.terminate(run_id)
        return await asyncio.to_thread(self.database.cancel, run_id)

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
            # startup. Do not launch an engine for a row already terminal.
            current = await asyncio.to_thread(self.database.get_run, run.run_id)
            if current.status != "RUNNING" or current.execution_generation != run.execution_generation:
                return
            rule = self.catalog.get(run.rule_id)
            if rule is None:
                await asyncio.to_thread(self.database.finish, run.run_id, run.execution_generation, "FAILED", False,
                                        "规则注册已不存在", [], None)
                return
            directory = Path(tempfile.mkdtemp(prefix=f"dataos-quality-{run.run_id}-"))
            try:
                namespace = tenant_namespace(run.tenant_id, run.institution_id, run.execution_generation)
                result = await self.engine.execute(run, rule, directory, namespace)
                artifact_uri = await self._store_artifact(result, namespace, run)
                accepted = await asyncio.to_thread(
                    self.database.finish, run.run_id, run.execution_generation,
                    result.status, result.passed, result.message,
                    result.evidence, artifact_uri
                )
                if not accepted and artifact_uri:
                    self.artifacts.delete(artifact_uri)
            except asyncio.CancelledError:
                await asyncio.to_thread(self.database.finish, run.run_id, run.execution_generation,
                                        "CANCELED", False, "执行已取消", [], None)
                raise
            except Exception as exc:
                await asyncio.to_thread(self.database.finish, run.run_id, run.execution_generation,
                                        "FAILED", False, safe_message(str(exc)), [], None)
            finally:
                shutil.rmtree(directory, ignore_errors=True)

    async def _store_artifact(self, result, namespace: str, run: QualityRun) -> str | None:
        if result.artifact_payload is None:
            return None
        artifact_uri = await asyncio.to_thread(
            self.artifacts.store, namespace, run.run_id, result.artifact_payload,
            run.execution_generation)
        if not await asyncio.to_thread(self.database.owns_generation, run.run_id,
                                       run.execution_generation):
            self.artifacts.delete(artifact_uri)
            return None
        return artifact_uri

    async def _maintenance_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.sleep(3600)
                await asyncio.to_thread(self.engine.maintenance)
                await asyncio.to_thread(self.artifacts.cleanup, self.settings.artifact_retention_days)
            except asyncio.CancelledError:
                raise
            except Exception:
                # A maintenance outage must not stop execution; the next
                # interval retries cleanup and the startup pass is idempotent.
                continue
