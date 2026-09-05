"""DataOS ToB Data API 网关装配。"""
from __future__ import annotations

import logging
import threading

from fastapi import FastAPI

from api import bind, bind_exports, router
from artifacts import ExportArtifactStore
from controlplane import ControlPlaneClient
from exports import ExportManager
from settings import Settings

logger = logging.getLogger(__name__)

settings = Settings()
settings.validate()
_control_plane = ControlPlaneClient(settings)
bind(_control_plane, settings)
_artifacts = ExportArtifactStore(settings)
_export_manager = ExportManager(_control_plane, settings, _artifacts)
bind_exports(_export_manager)

app = FastAPI(title="DataOS Data API", version="0.2.0",
              description="ToB 数据服务网关：参数化查询与大结果集异步导出")
app.include_router(router)

MAINTENANCE_INTERVAL_S = 3600


@app.on_event("startup")
def recover_and_start_maintenance() -> None:
    """启动恢复（孤儿清算 + PENDING 拾取）与小时级维护循环（产物清理/到期标记）。"""
    try:
        logger.info("导出启动恢复: %s", _export_manager.recover())
    except Exception:  # noqa: BLE001  恢复失败不阻塞服务面
        logger.exception("导出启动恢复失败（控制面不可达？）")

    def loop() -> None:
        import time

        while True:
            time.sleep(MAINTENANCE_INTERVAL_S)
            try:
                _export_manager.maintenance()
            except Exception:  # noqa: BLE001
                logger.exception("导出维护循环异常")

    threading.Thread(target=loop, name="export-maintenance", daemon=True).start()


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "UP"}


@app.get("/readyz")
def readyz() -> dict[str, object]:
    return {"status": "UP", "registryServices": len(_control_plane.registry().get("services", []))}
