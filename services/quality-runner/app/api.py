from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field

from db import RunnerDatabase
from models import RuleDefinition
from rulegen import DIMENSION_BY_TYPE, DynamicRuleSpec, selector_for
from runner import QualityRunManager
from security import Principal, check_scope, principal
from settings import settings as runner_settings


class RunRequest(BaseModel):
    # title/datasetId 由控制面发送但不参与执行（规则目录才是权威），
    # Pydantic 忽略额外字段，模型不再谎称接收它们。
    issueId: str = Field(min_length=1, max_length=128)
    tenantId: str = Field(min_length=1, max_length=128)
    institutionId: str = Field(min_length=1, max_length=128)
    ruleId: str = Field(min_length=1, max_length=200)
    executionBatchId: str = Field(min_length=1, max_length=128)


def _require_tenant_match(current: Principal, tenant_id: str, institution_id: str) -> None:
    if current.tenant_id != "*" and (tenant_id != current.tenant_id or institution_id != current.institution_id):
        raise HTTPException(status_code=403, detail="tenant scope mismatch")


def router(manager: QualityRunManager) -> APIRouter:
    api = APIRouter(prefix="/api/v1/quality")

    @api.post("/runs", status_code=status.HTTP_202_ACCEPTED)
    async def submit(body: RunRequest, response: Response, current: Principal = Depends(principal),
                     idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")) -> dict[str, Any]:
        check_scope(current, "quality:submit")
        _require_tenant_match(current, body.tenantId, body.institutionId)
        key = (idempotency_key or body.executionBatchId).strip()
        if not key or len(key) > 200:
            raise HTTPException(status_code=400, detail="Idempotency-Key is required")
        try:
            run = await manager.submit({
                "issue_id": body.issueId, "tenant_id": body.tenantId, "institution_id": body.institutionId,
                "rule_id": body.ruleId, "execution_batch_id": body.executionBatchId,
                "idempotency_key": key,
            })
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        response.headers["Idempotency-Key"] = key
        return {"runId": run.run_id, "externalId": run.run_id, "status": run.status,
                "executionBatchId": run.execution_batch_id, "message": run.message}

    @api.get("/runs/{run_id}")
    async def get(run_id: str, current: Principal = Depends(principal)) -> dict[str, Any]:
        check_scope(current, "quality:read")
        try:
            run = await manager.get(run_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="quality run not found") from exc
        _require_tenant_match(current, run.tenant_id, run.institution_id)
        return {"runId": run.run_id, "externalId": run.run_id, "status": run.status,
                "passed": run.passed, "executionBatchId": run.execution_batch_id,
                "message": run.message, "sampleEvidence": run.sample_evidence,
                "artifactUri": run.artifact_uri, "startedAt": run.started_at,
                "finishedAt": run.finished_at}

    @api.post("/runs/{run_id}/cancel")
    async def cancel(run_id: str, current: Principal = Depends(principal)) -> dict[str, Any]:
        check_scope(current, "quality:cancel")
        try:
            run = await manager.get(run_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="quality run not found") from exc
        _require_tenant_match(current, run.tenant_id, run.institution_id)
        await manager.cancel(run_id)
        run = await manager.get(run_id)
        return {"runId": run.run_id, "status": run.status, "message": run.message}

    return api


class DynamicRuleRequest(BaseModel):
    """动态规则定义（G2G 批次 2）：控制面台账推送的完整意图。"""
    ruleId: str = Field(min_length=3, max_length=200)
    ruleType: str = Field(min_length=2, max_length=32)
    datasetId: str = Field(min_length=3, max_length=300)
    column: str = Field(default="", max_length=128)
    params: dict[str, Any] = Field(default_factory=dict)
    evidenceColumns: list[dict[str, str]] = Field(default_factory=list)


def rules_router(database: RunnerDatabase) -> APIRouter:
    """动态规则管理面：校验 → 生成 singular test SQL → 落 registry。

    registry 与 dbt 工程的属主都在 runner——与 rules.yml 静态规则共用同一张
    注册表和同一执行链（selector 路由 + 失败表证据）。
    """
    api = APIRouter(prefix="/api/v1/quality/rules/dynamic", tags=["dynamic-rules"])

    @api.put("/{rule_id}")
    async def upsert(rule_id: str, body: DynamicRuleRequest,
                     current: Principal = Depends(principal)) -> dict[str, Any]:
        check_scope(current, "quality:admin")
        if rule_id != body.ruleId:
            raise HTTPException(status_code=400, detail="ruleId 与路径不一致")
        spec = DynamicRuleSpec(
            rule_id=body.ruleId, rule_type=body.ruleType, dataset_id=body.datasetId,
            column=body.column, params=body.params, evidence_columns=body.evidenceColumns,
        )
        try:
            spec.validate()
            sql = spec.compile_sql()
            evidence = spec.evidence_contract()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        selector = selector_for(spec.rule_id)
        dynamic_dir = Path(runner_settings.project_dir) / "tests" / "dynamic"
        dynamic_dir.mkdir(parents=True, exist_ok=True)
        (dynamic_dir / f"{selector}.sql").write_text(sql + "\n", encoding="utf-8")
        database.upsert_rules([RuleDefinition(spec.rule_id, selector, spec.dataset_id, evidence)])
        return {
            "ruleId": spec.rule_id, "selector": selector, "datasetId": spec.dataset_id,
            "ruleType": spec.rule_type, "dimension": DIMENSION_BY_TYPE.get(spec.rule_type, ""),
            "evidence": evidence,
        }

    @api.delete("/{rule_id}")
    async def disable(rule_id: str, current: Principal = Depends(principal)) -> dict[str, Any]:
        check_scope(current, "quality:admin")
        selector = selector_for(rule_id)
        removed = False
        target = Path(runner_settings.project_dir) / "tests" / "dynamic" / f"{selector}.sql"
        if target.exists():
            target.unlink()
            removed = True
        disabled = database.disable_rule(rule_id)
        if not removed and not disabled:
            raise HTTPException(status_code=404, detail="dynamic rule not found")
        return {"ruleId": rule_id, "selector": selector, "enabled": False}

    return api
