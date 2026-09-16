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
    assert len(payload["requirements"]) == 17
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


class _EvalDoris:
    def __init__(self, expected_table: str):
        self.expected_table = expected_table

    def __call__(self, settings):
        return self

    def query(self, sql, args):
        assert self.expected_table in sql, f"语料表解析错误：{sql}"
        return [("c1", "doc-1", "心血管内科",
                 "门诊处方记录：科室：心血管内科。处方药品：1）药品 X，规格 S，用法 口服，频率 每日一次，用药 7 天。")]


_EVALSET = ("{\"question\": \"药品X的用法？\", \"expected_document_id\": \"doc-1\", "
            "\"expected_section\": \"\", \"golden_sentence\": \"用法 口服\"}\n") * 2


def test_evaluate_resolves_corpus_from_recipe_ref(client, monkeypatch, tmp_path):
    """G17 双产品契约：recipeRef → Recipe 的 output（语料表 + 评测集）。"""
    (tmp_path / "recipes").mkdir()
    (tmp_path / "recipes" / "ep-x.yaml").write_text(
        "apiVersion: data-os/v1\nkind: AIDatasetRecipe\nmetadata: {name: ep-x, version: 1.0.0}\n"
        "spec:\n  workload: {type: medical-rag}\n  output:\n"
        "    doris_table: dataos_ai.chunks_ep\n    eval_file: eval/ep.jsonl\n",
        encoding="utf-8")
    (tmp_path / "eval").mkdir()
    (tmp_path / "eval" / "ep.jsonl").write_text(_EVALSET, encoding="utf-8")
    monkeypatch.setenv("AI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(api, "DorisAdapter", _EvalDoris("chunks_ep"))
    response = client.post("/evaluate",
                           json={"product": "p", "recipeRef": "recipes/ep-x.yaml"},
                           headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["eval_set_size"] == 2 and payload["mrr"] == 1.0


def test_evaluate_falls_back_to_default_corpus_without_recipe_ref(client, monkeypatch, tmp_path):
    """recipeRef 缺省时回落单产品时代默认（dataos_ai.chunks + medical-rag 评测集）。"""
    (tmp_path / "eval").mkdir()
    (tmp_path / "eval" / "medical-rag-evalset.jsonl").write_text(_EVALSET, encoding="utf-8")
    monkeypatch.setenv("AI_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(api, "DorisAdapter", _EvalDoris("dataos_ai.chunks"))
    response = client.post("/evaluate", json={"product": "p"},
                           headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert response.json()["eval_set_size"] == 2


# ---- G18-1：POST /build 构建执行面 ----


class _BuildDoris:
    """构建写入桩：记录全部 SQL（DELETE/写批）与写入行数，table_exists 不涉及。"""

    def __init__(self):
        self.sqls: list[str] = []
        self.written_rows = 0

    def __call__(self, settings):
        return self

    def query(self, sql, args):
        self.sqls.append(sql)
        return []

    def execute_many(self, sql, args_list):
        self.sqls.append(sql)
        self.written_rows += len(args_list)
        return len(args_list)


class _BuildS3:
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    class exceptions:
        class ClientError(Exception):
            pass

    def head_bucket(self, Bucket):
        return {}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise self.exceptions.ClientError("404")
        return {}

    def put_object(self, Bucket, Key, Body):
        self.objects[Key] = Body


@pytest.fixture()
def build_env(monkeypatch, tmp_path):
    """临时 AI_DATA_DIR：复用仓库语料与 medical-rag-v1 recipe，写入桩接管 Doris/RustFS。"""
    import shutil
    from conftest import REPO_ROOT
    shutil.copytree(REPO_ROOT / "ai-data", tmp_path / "ai-data")
    monkeypatch.setenv("AI_DATA_DIR", str(tmp_path / "ai-data"))
    doris = _BuildDoris()
    s3 = _BuildS3()
    monkeypatch.setattr(api, "DorisAdapter", doris)
    monkeypatch.setattr(api, "_rustfs_client", lambda: s3)
    return doris, s3, tmp_path / "ai-data"


def test_build_executes_documents_recipe_end_to_end(client, build_env):
    doris, s3, _ = build_env
    response = client.post("/build",
                           json={"product": "p", "version": "v0.2.0", "recipeRef": "medical-rag-v1"},
                           headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["recipe"] == "medical-rag-v1" and payload["chunks"] > 0
    assert payload["doris"]["written"] == payload["chunks"] and payload["doris"]["reset"] is False
    assert payload["rustfs"]["version"] == "v1.0.0"
    inserts = [sql for sql in doris.sqls if sql.startswith("INSERT")]
    assert len(inserts) >= 1 and doris.written_rows == payload["chunks"]  # 批量写
    assert not any("DELETE" in sql for sql in doris.sqls)
    assert f"{payload['rustfs']['prefix']}/v1.0.0/manifest.yaml" in s3.objects


def test_build_reset_flag_clears_product_table_first(client, build_env):
    import yaml as _yaml
    _, __, ai_data = build_env
    recipe_path = ai_data / "recipes" / "medical-rag-v1.yaml"
    recipe = _yaml.safe_load(recipe_path.read_text(encoding="utf-8"))
    recipe["spec"]["output"]["reset_before_write"] = True
    recipe_path.write_text(_yaml.safe_dump(recipe, allow_unicode=True), encoding="utf-8")
    response = client.post("/build",
                           json={"product": "p", "recipeRef": "medical-rag-v1"},
                           headers={"Authorization": "Bearer test-token"})
    assert response.status_code == 200
    assert response.json()["doris"]["reset"] is True
    doris, _, _ = build_env
    assert any("DELETE FROM dataos_ai.chunks" in sql for sql in doris.sqls)


def test_build_requires_auth_and_known_recipe(client, build_env):
    unauth = client.post("/build", json={"product": "p", "recipeRef": "medical-rag-v1"})
    assert unauth.status_code == 401
    missing = client.post("/build", json={"product": "p", "recipeRef": "no-such-recipe"},
                          headers={"Authorization": "Bearer test-token"})
    assert missing.status_code == 404
    assert "no-such-recipe" in missing.json()["detail"]
