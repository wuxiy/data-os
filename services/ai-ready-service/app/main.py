from __future__ import annotations

from fastapi import FastAPI, status
from fastapi.responses import PlainTextResponse, Response

from adapters import DorisAdapter, OpenMetadataAdapter
from api import bind, router
from catalog import load_catalog
from engine import Engine
from security import Authenticator
from settings import settings


settings.validate()
_catalog = load_catalog(settings.repo_dir)
_engine = Engine(_catalog, DorisAdapter(settings), OpenMetadataAdapter(settings))
bind(_engine, Authenticator(settings))

app = FastAPI(title="DataOS AI Ready Engine", version="0.1.0")
app.include_router(router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "UP"}


@app.get("/readyz")
def readyz() -> dict[str, object]:
    ready = _catalog is not None and _engine is not None
    return {"status": "UP" if ready else "DOWN",
            "requirements": len(_catalog.requirements), "profiles": sorted(_catalog.profiles)}
