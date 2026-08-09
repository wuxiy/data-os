from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status
from fastapi.responses import PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from api import router
from db import RunnerDatabase
from rules import RuleCatalog
from runner import QualityRunManager
from settings import settings


settings.validate()
catalog = RuleCatalog(settings.rules_file)
database = RunnerDatabase(settings.db_url)
manager = QualityRunManager(database, catalog, settings)
manager_ready = False


@asynccontextmanager
async def lifespan(_: FastAPI):
    global manager_ready
    await manager.start()
    manager_ready = True
    yield
    manager_ready = False
    await manager.stop()


app = FastAPI(title="DataOS Quality Runner", version="0.1.0", lifespan=lifespan)
app.include_router(router(manager))


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "UP"}


@app.get("/readyz")
def readyz(response: Response) -> dict[str, str]:
    if not manager_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "DOWN"}
    return {"status": "UP"}


@app.get("/metrics")
def metrics() -> PlainTextResponse:
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)
