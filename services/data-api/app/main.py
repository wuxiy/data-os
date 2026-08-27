"""DataOS ToB Data API 网关装配。"""
from __future__ import annotations

from fastapi import FastAPI

from api import bind, router
from controlplane import ControlPlaneClient
from settings import Settings

settings = Settings()
settings.validate()
_control_plane = ControlPlaneClient(settings)
bind(_control_plane, settings)

app = FastAPI(title="DataOS Data API", version="0.1.0",
              description="ToB 数据服务网关：参数化查询已发布数据产品")
app.include_router(router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "UP"}


@app.get("/readyz")
def readyz() -> dict[str, object]:
    return {"status": "UP", "registryServices": len(_control_plane.registry().get("services", []))}
