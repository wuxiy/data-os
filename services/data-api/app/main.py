"""DataOS ToB Data API 网关装配。"""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from fastapi import FastAPI

from api import bind, bind_breaker, bind_exports, router
from artifacts import ExportArtifactStore
from auditbuffer import AuditBuffer
from breaker import DorisBreaker
from controlplane import ControlPlaneClient
from exports import ExportManager
from settings import Settings

logger = logging.getLogger(__name__)

settings = Settings()
settings.validate()
_audit_buffer = AuditBuffer(Path(settings.audit_buffer_path),
                            max_age_hours=settings.audit_max_age_hours)
_control_plane = ControlPlaneClient(settings, audit_buffer=_audit_buffer)
_breaker = DorisBreaker(failure_threshold=settings.breaker_failure_threshold,
                        open_seconds=settings.breaker_open_seconds)
bind(_control_plane, settings)
bind_breaker(_breaker)
_artifacts = ExportArtifactStore(settings)
_export_manager = ExportManager(_control_plane, settings, _artifacts, breaker=_breaker)
bind_exports(_export_manager)

app = FastAPI(title="DataOS Data API", version="0.2.0",
              description="ToB 数据服务网关：参数化查询与大结果集异步导出")
app.include_router(router)

AUDIT_REPLAY_INTERVAL_S = max(settings.audit_replay_interval_s, 1)
EXPORT_MAINTENANCE_INTERVAL_S = 3600


@app.on_event("startup")
def recover_and_start_maintenance() -> None:
    """维护线程：先做启动恢复（带重试——data-api 可能先于控制面就绪），
    然后每 30s 重放审计缓冲、每 1h 导出产物清理与到期标记。"""
    import time

    state = {"tick": 0}

    def maintenance_loop() -> None:
        for attempt in range(5):
            try:
                logger.info("导出启动恢复: %s", _export_manager.recover())
                break
            except Exception:  # noqa: BLE001
                logger.warning("导出启动恢复暂不可达（第 %d 次）", attempt + 1)
                time.sleep(10)
        else:
            logger.error("导出启动恢复 5 次重试后放弃（PENDING 任务待下轮维护拾取）")
        ticks_per_hour = max(EXPORT_MAINTENANCE_INTERVAL_S // AUDIT_REPLAY_INTERVAL_S, 1)
        while True:
            time.sleep(AUDIT_REPLAY_INTERVAL_S)
            state["tick"] += 1
            try:
                _control_plane.replay_audit()
            except Exception:  # noqa: BLE001
                logger.exception("审计缓冲重放异常")
            if state["tick"] % ticks_per_hour == 0:
                try:
                    _export_manager.maintenance()
                except Exception:  # noqa: BLE001
                    logger.exception("导出维护循环异常")

    threading.Thread(target=maintenance_loop, name="data-api-maintenance", daemon=True).start()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "UP"}


@app.get("/readyz")
def readyz() -> dict[str, object]:
    return {"status": "UP", "registryServices": len(_control_plane.registry().get("services", []))}
