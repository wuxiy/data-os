from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Response, status
from fastapi.responses import PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from api import router
from artifacts import ArtifactStore
from db import RunnerDatabase
from engines import DbtEngine
from evidence import EvidenceReader
from rules import RuleCatalog
from runner import QualityRunManager
from settings import settings
from supervisor import ProcessSupervisor


settings.validate()
catalog = RuleCatalog(settings.rules_file)
database = RunnerDatabase(settings.db_url)
# 装配根：引擎族（dbt 引擎 + 失败表证据读取）与产物存储在此构造——
# manager 只做编排，第二个引擎（GE / 医院质检）到来时在此接入。
supervisor = ProcessSupervisor(database, settings.stale_run_seconds)
engine = DbtEngine(
    settings,
    EvidenceReader(
        settings.doris_host, settings.doris_port, settings.doris_audit_database,
        settings.doris_user, settings.doris_password, settings.evidence_limit,
        settings.doris_cleanup_user, settings.doris_cleanup_password,
        settings.evidence_hash_key,
    ),
    supervisor,
    catalog,
)
artifacts = ArtifactStore(
    settings.artifact_dir, settings.artifact_s3_endpoint,
    settings.artifact_s3_bucket, settings.artifact_s3_region,
    settings.artifact_s3_access_key, settings.artifact_s3_secret_key)
manager = QualityRunManager(database, catalog, settings, engine, supervisor, artifacts)
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
