from __future__ import annotations

import asyncio
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

from db import RunnerDatabase


@dataclass
class ProcessOutcome:
    stdout: bytes
    stderr: bytes
    returncode: int | None
    timed_out: bool


class ProcessSupervisor:
    """引擎无关的子进程监督：进程注册表、心跳续租、超时击杀、取消终止。

    取消（CancelledError）传播给调用方之前先终止子进程，保证被标记
    CANCELED 的运行不会留下仍在改写失败表的残留进程。
    """

    def __init__(self, database: RunnerDatabase, stale_run_seconds: int):
        self.database = database
        self.stale_run_seconds = stale_run_seconds
        self._processes: dict[str, asyncio.subprocess.Process] = {}

    async def run(self, *, run_id: str, execution_generation: int,
                  command: list[str], cwd: str, env: dict[str, str],
                  timeout: float) -> ProcessOutcome:
        process = await asyncio.create_subprocess_exec(
            *command, cwd=cwd, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        self._processes[run_id] = process
        heartbeat = asyncio.create_task(
            self._heartbeat_loop(run_id, execution_generation, process)
        )
        try:
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout)
                return ProcessOutcome(stdout, stderr, process.returncode, False)
            except asyncio.TimeoutError:
                process.kill()
                stdout, stderr = await process.communicate()
                return ProcessOutcome(stdout, stderr, process.returncode, True)
            except asyncio.CancelledError:
                if process.returncode is None:
                    process.terminate()
                    with suppress(ProcessLookupError):
                        await process.communicate()
                raise
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat
            if self._processes.get(run_id) is process:
                self._processes.pop(run_id, None)

    def terminate(self, run_id: str) -> None:
        process = self._processes.get(run_id)
        if process is not None and process.returncode is None:
            process.terminate()

    async def shutdown(self) -> None:
        for process in list(self._processes.values()):
            if process.returncode is None:
                process.terminate()

    async def _heartbeat_loop(self, run_id: str, execution_generation: int,
                              process: asyncio.subprocess.Process) -> None:
        interval = max(5, min(60, self.stale_run_seconds // 3))
        while True:
            await asyncio.sleep(interval)
            try:
                owns_generation = await asyncio.to_thread(
                    self.database.heartbeat, run_id, execution_generation
                )
                if not owns_generation:
                    if process.returncode is None:
                        process.terminate()
                    return
            except Exception:
                # A transient database outage should not kill the engine
                # process; startup requeue remains the recovery authority.
                continue
