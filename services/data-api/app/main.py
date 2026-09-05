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
    """启动恢复（孤儿清算 + PENDING 拾取）与维护循环：
    每 30s 重放审计缓冲，每 1h 导出产物清理与到期标记。"""
    try:
        logger.info("导出启动恢复: %s", _export_manager.recover())
    except Exception:  # noqa: BLE001  恢复失败不阻塞服务面
        logger.exception("导出启动恢复失败（控制面不可达？）")

    import time

    # 简化节拍：每 tick（默认 30s）重放审计缓冲；每 N tick（默认 1h）做导出维护
    state = {"tick": 0}

    def maintenance_loop() -> None:
        import time

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
