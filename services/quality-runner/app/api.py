from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel, Field

from runner import QualityRunManager
from security import Principal, check_scope, principal


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
