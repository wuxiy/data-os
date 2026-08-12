from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from models import QualityRun, RuleDefinition


SCHEMA_SQL = """
CREATE SCHEMA IF NOT EXISTS data_os;
CREATE TABLE IF NOT EXISTS data_os.quality_rule_registry (
    rule_id VARCHAR(200) PRIMARY KEY,
    selector VARCHAR(300) NOT NULL,
    dataset_id VARCHAR(300) NOT NULL,
    evidence_json TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version VARCHAR(64) NOT NULL DEFAULT '1',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS data_os.quality_runner_runs (
    run_id VARCHAR(128) PRIMARY KEY,
    issue_id VARCHAR(128) NOT NULL,
    tenant_id VARCHAR(128) NOT NULL,
    institution_id VARCHAR(128) NOT NULL,
    rule_id VARCHAR(200) NOT NULL,
    dataset_id VARCHAR(300) NOT NULL,
    execution_batch_id VARCHAR(128) NOT NULL,
    idempotency_key VARCHAR(200) NOT NULL,
    status VARCHAR(32) NOT NULL,
    passed BOOLEAN NULL,
    message VARCHAR(1000) NOT NULL DEFAULT '',
    sample_evidence_json TEXT NOT NULL DEFAULT '[]',
    artifact_uri VARCHAR(1000) NULL,
    started_at TIMESTAMP NULL,
    finished_at TIMESTAMP NULL,
    heartbeat_at TIMESTAMP NULL,
    execution_generation BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_quality_runner_queue
    ON data_os.quality_runner_runs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_quality_runner_tenant
    ON data_os.quality_runner_runs(tenant_id, status, created_at);
ALTER TABLE data_os.quality_runner_runs
    ADD COLUMN IF NOT EXISTS execution_generation BIGINT NOT NULL DEFAULT 0;
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class RunnerDatabase:
    def __init__(self, url: str):
        self.engine: Engine = create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)

    def ensure_schema(self) -> None:
        with self.engine.begin() as connection:
            for statement in SCHEMA_SQL.split(";"):
                if statement.strip():
                    connection.execute(text(statement))

    def upsert_rules(self, rules: list[RuleDefinition]) -> None:
        with self.engine.begin() as connection:
            for rule in rules:
                connection.execute(text("""
                    INSERT INTO data_os.quality_rule_registry
                        (rule_id, selector, dataset_id, evidence_json, enabled, version, updated_at)
                    VALUES (:rule_id, :selector, :dataset_id, :evidence_json, TRUE, '1', CURRENT_TIMESTAMP)
                    ON CONFLICT (rule_id) DO UPDATE SET
                        selector = EXCLUDED.selector,
                        dataset_id = EXCLUDED.dataset_id,
                        evidence_json = EXCLUDED.evidence_json,
                        enabled = TRUE,
                        updated_at = CURRENT_TIMESTAMP
                """), {
                    "rule_id": rule.rule_id,
                    "selector": rule.selector,
                    "dataset_id": rule.dataset_id,
                    "evidence_json": json.dumps(rule.evidence, ensure_ascii=False),
                })

    def create_or_get_run(self, payload: dict[str, Any], rule: RuleDefinition) -> QualityRun:
        run_id = payload["execution_batch_id"]
        now = utcnow()
        values = {
            "run_id": run_id,
            "issue_id": payload.get("issue_id", "quality-runner"),
            "tenant_id": payload["tenant_id"],
            "institution_id": payload["institution_id"],
            "rule_id": rule.rule_id,
            "dataset_id": rule.dataset_id,
            "execution_batch_id": payload["execution_batch_id"],
            "idempotency_key": payload["idempotency_key"],
            "status": "QUEUED",
            "message": "质量规则已排队",
            "created_at": now,
            "updated_at": now,
        }
        try:
            with self.engine.begin() as connection:
                connection.execute(text("""
                    INSERT INTO data_os.quality_runner_runs
                      (run_id, issue_id, tenant_id, institution_id, rule_id, dataset_id,
                       execution_batch_id, idempotency_key, status, message, created_at, updated_at)
                    VALUES (:run_id, :issue_id, :tenant_id, :institution_id, :rule_id, :dataset_id,
                       :execution_batch_id, :idempotency_key, :status, :message, :created_at, :updated_at)
                """), values)
        except IntegrityError:
            existing = self.find_by_idempotency(payload["tenant_id"], payload["idempotency_key"])
            if existing is not None:
                return existing
            raise
        return self.get_run(run_id)

    def find_by_idempotency(self, tenant_id: str, idempotency_key: str) -> QualityRun | None:
        with self.engine.connect() as connection:
            row = connection.execute(text("""
                SELECT * FROM data_os.quality_runner_runs
                WHERE tenant_id = :tenant_id AND idempotency_key = :idempotency_key
            """), {"tenant_id": tenant_id, "idempotency_key": idempotency_key}).mappings().first()
        return self._map(row) if row else None

    def get_run(self, run_id: str) -> QualityRun:
        with self.engine.connect() as connection:
            row = connection.execute(text(
                "SELECT * FROM data_os.quality_runner_runs WHERE run_id = :run_id"
            ), {"run_id": run_id}).mappings().first()
        if not row:
            raise KeyError(run_id)
        return self._map(row)

    def claim_next(self, run_id: str | None = None) -> QualityRun | None:
        with self.engine.begin() as connection:
            if run_id:
                row = connection.execute(text("""
                    SELECT * FROM data_os.quality_runner_runs
                    WHERE run_id = :run_id AND status = 'QUEUED'
                    FOR UPDATE SKIP LOCKED
                """), {"run_id": run_id}).mappings().first()
            else:
                row = connection.execute(text("""
                    SELECT * FROM data_os.quality_runner_runs
                    WHERE status = 'QUEUED'
                    ORDER BY created_at
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                """)).mappings().first()
            if not row:
                return None
            connection.execute(text("""
                UPDATE data_os.quality_runner_runs
                SET status = 'RUNNING', started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                    heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
                    execution_generation = execution_generation + 1
                WHERE run_id = :run_id
            """), {"run_id": row["run_id"]})
            return self._map({
                **row,
                "status": "RUNNING",
                "started_at": row["started_at"] or utcnow(),
                "execution_generation": row["execution_generation"] + 1,
            })

    def heartbeat(self, run_id: str, execution_generation: int) -> bool:
        with self.engine.begin() as connection:
            result = connection.execute(text("""
                UPDATE data_os.quality_runner_runs
                SET heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = :run_id AND status = 'RUNNING'
                  AND execution_generation = :execution_generation
            """), {"run_id": run_id, "execution_generation": execution_generation})
        return result.rowcount == 1

    def owns_generation(self, run_id: str, execution_generation: int) -> bool:
        with self.engine.connect() as connection:
            row = connection.execute(text("""
                SELECT 1
                FROM data_os.quality_runner_runs
                WHERE run_id = :run_id AND status = 'RUNNING'
                  AND execution_generation = :execution_generation
            """), {
                "run_id": run_id, "execution_generation": execution_generation,
            }).first()
        return row is not None

    def finish(self, run_id: str, execution_generation: int, status: str, passed: bool | None, message: str,
               evidence: list[dict[str, Any]], artifact_uri: str | None) -> bool:
        with self.engine.begin() as connection:
            result = connection.execute(text("""
                UPDATE data_os.quality_runner_runs
                SET status = :status, passed = :passed, message = :message,
                    sample_evidence_json = :evidence, artifact_uri = :artifact_uri,
                    finished_at = CURRENT_TIMESTAMP, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = :run_id AND status = 'RUNNING'
                  AND execution_generation = :execution_generation
            """), {
                "run_id": run_id, "execution_generation": execution_generation,
                "status": status, "passed": passed,
                "message": message[:1000], "evidence": json.dumps(evidence[:20], ensure_ascii=False),
                "artifact_uri": artifact_uri,
            })
        return result.rowcount == 1

    def cancel(self, run_id: str) -> bool:
        with self.engine.begin() as connection:
            result = connection.execute(text("""
                UPDATE data_os.quality_runner_runs
                SET status = 'CANCELED', passed = FALSE, message = '质量规则执行已取消',
                    finished_at = CURRENT_TIMESTAMP, heartbeat_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE run_id = :run_id AND status IN ('QUEUED', 'RUNNING')
            """), {"run_id": run_id})
        return result.rowcount == 1

    def requeue_stale(self, stale_seconds: int) -> int:
        with self.engine.begin() as connection:
            result = connection.execute(text("""
                UPDATE data_os.quality_runner_runs
                SET status = 'QUEUED', message = 'Runtime 重启后恢复排队', heartbeat_at = NULL,
                    updated_at = CURRENT_TIMESTAMP, execution_generation = execution_generation + 1
                WHERE status = 'RUNNING'
                  AND (heartbeat_at IS NULL OR heartbeat_at < CURRENT_TIMESTAMP - (:seconds * INTERVAL '1 second'))
            """), {"seconds": stale_seconds})
        return result.rowcount

    @staticmethod
    def _map(row: Any) -> QualityRun:
        return QualityRun(
            run_id=row["run_id"], issue_id=row["issue_id"], tenant_id=row["tenant_id"],
            institution_id=row["institution_id"], rule_id=row["rule_id"], dataset_id=row["dataset_id"],
            execution_batch_id=row["execution_batch_id"], idempotency_key=row["idempotency_key"],
            status=row["status"], passed=row["passed"], message=row["message"] or "",
            sample_evidence=json.loads(row["sample_evidence_json"] or "[]"),
            artifact_uri=row["artifact_uri"], started_at=row["started_at"], finished_at=row["finished_at"],
            created_at=row["created_at"], execution_generation=row["execution_generation"],
        )
