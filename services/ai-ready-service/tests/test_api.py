"""API 契约：认证拒绝（401）与 assess 端点（stub 引擎注入）。"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api
from catalog import load_catalog
from conftest import REPO, StubDoris, StubOm, all_pass_metrics
from engine import Engine
from security import Authenticator
from settings import Settings


@pytest.fixture()
def client():
    catalog = load_catalog(str(REPO))
    engine = Engine(catalog, StubDoris(all_pass_metrics()), StubOm(all_pass_metrics()))
    authenticator = Authenticator(Settings(api_token="test-token"))
    api.bind(engine, authenticator)
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)


def test_assess_requires_token(client):
    response = client.post("/assess", json={"product": "p", "profile": "medical-rag"})
    assert response.status_code == 401


def test_assess_rejects_wrong_token(client):
    response = client.post("/assess", json={"product": "p", "profile": "medical-rag"},
                           headers={"Authorization": "Bearer nope"})
    assert response.status_code == 401


def test_assess_returns_report(client):
    response = client.post("/assess",
                           json={"product": "p", "version": "v0.2.0", "profile": "medical-rag"},
                           headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["product"] == "p" and payload["version"] == "v0.2.0"
    assert payload["gate"]["certification"] == "CANDIDATE"
    assert len(payload["requirements"]) == 10
    # 产物零口令：响应文本不含任何凭据键
    assert "password" not in response.text and "secret" not in response.text


def test_readiness_endpoint(client):
    response = client.get("/readiness", params={"product": "p", "profile": "medical-rag"},
                          headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert response.json()["profile"] == "medical-rag"


def test_assess_requires_explicit_profile(client):
    # profile 无缺省：词汇表唯一源是声明仓库 profiles/，缺省即静默猜测。
    response = client.post("/assess", json={"product": "p"},
                           headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 422


def test_assess_rejects_unknown_profile(client):
    response = client.post("/assess",
                           json={"product": "p", "profile": "clinical-llm"},
                           headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 422
    assert "未知 Profile" in response.json()["detail"]


def test_recipe_ref_is_accepted_not_dropped(client):
    """控制面 build 链路的 recipeRef 显式收下（不再被 pydantic 静默忽略）。"""
    response = client.post("/assess",
                           json={"product": "p", "profile": "medical-rag", "recipeRef": "recipes/medical-rag-v1.yaml"},
                           headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
