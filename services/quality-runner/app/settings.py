from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _int_env(name: str, default: int) -> int:
    value = _env(name, str(default))
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


@dataclass(frozen=True)
class Settings:
    environment: str = field(default_factory=lambda: _env("QUALITY_RUNNER_ENV", "development"))
    auth_mode: str = field(default_factory=lambda: _env("QUALITY_RUNNER_AUTH_MODE", "ENFORCED").upper())
    oidc_issuer: str = field(default_factory=lambda: _env("QUALITY_RUNNER_OIDC_ISSUER"))
    oidc_audience: str = field(default_factory=lambda: _env("QUALITY_RUNNER_OIDC_AUDIENCE", "dataos-quality-runner"))
    oidc_required_scopes: tuple[str, ...] = field(default_factory=lambda: tuple(
        item for item in _env("QUALITY_RUNNER_OIDC_REQUIRED_SCOPES", "quality:submit quality:read quality:cancel").split() if item
    ))
    db_url: str = field(default_factory=lambda: _env(
        "QUALITY_RUNNER_DB_URL", "postgresql+psycopg://data_os:change-me@postgres:5432/data_os"
    ))
    project_dir: str = field(default_factory=lambda: _env("QUALITY_RUNNER_PROJECT_DIR", "/opt/dataos/quality/dbt"))
    profiles_dir: str = field(default_factory=lambda: _env("QUALITY_RUNNER_PROFILES_DIR", "/opt/dataos/quality/dbt"))
    target: str = field(default_factory=lambda: _env("QUALITY_RUNNER_DBT_TARGET", "quality"))
    dbt_binary: str = field(default_factory=lambda: _env("QUALITY_RUNNER_DBT_BINARY", "dbt"))
    rules_file: str = field(default_factory=lambda: _env("QUALITY_RUNNER_RULES_FILE", "/opt/dataos/quality/rules.yml"))
    artifact_dir: str = field(default_factory=lambda: _env("QUALITY_RUNNER_ARTIFACT_DIR", "/var/lib/dataos-quality/artifacts"))
    max_concurrency: int = field(default_factory=lambda: _int_env("QUALITY_RUNNER_MAX_CONCURRENCY", 2))
    max_concurrency_per_tenant: int = field(default_factory=lambda: _int_env("QUALITY_RUNNER_MAX_CONCURRENCY_PER_TENANT", 1))
    timeout_seconds: int = field(default_factory=lambda: _int_env("QUALITY_RUNNER_TIMEOUT_SECONDS", 900))
    evidence_limit: int = field(default_factory=lambda: _int_env("QUALITY_RUNNER_EVIDENCE_LIMIT", 20))
    stale_run_seconds: int = field(default_factory=lambda: _int_env("QUALITY_RUNNER_STALE_RUN_SECONDS", 120))
    doris_host: str = field(default_factory=lambda: _env("DORIS_FE_HOST"))
    doris_port: int = field(default_factory=lambda: _int_env("DORIS_FE_PORT", 9030))
    doris_database: str = field(default_factory=lambda: _env("DORIS_DATABASE", "dataos_quality_acceptance"))
    doris_audit_database: str = field(default_factory=lambda: _env("DORIS_AUDIT_DATABASE", "dataos_quality_audit"))
    doris_user: str = field(default_factory=lambda: _env("DORIS_USER"))
    doris_password: str = field(default_factory=lambda: os.getenv("DORIS_PASSWORD", ""))
    doris_dbt_user: str = field(default_factory=lambda: _env("DORIS_DBT_USER"))
    doris_dbt_password: str = field(default_factory=lambda: os.getenv("DORIS_DBT_PASSWORD", ""))
    doris_cleanup_user: str = field(default_factory=lambda: _env("DORIS_CLEANUP_USER"))
    doris_cleanup_password: str = field(default_factory=lambda: os.getenv("DORIS_CLEANUP_PASSWORD", ""))
    artifact_s3_endpoint: str = field(default_factory=lambda: _env("QUALITY_RUNNER_S3_ENDPOINT"))
    artifact_s3_bucket: str = field(default_factory=lambda: _env("QUALITY_RUNNER_S3_BUCKET", "dataos-quality-artifacts"))
    artifact_s3_region: str = field(default_factory=lambda: _env("QUALITY_RUNNER_S3_REGION", "us-east-1"))
    artifact_s3_access_key: str = field(default_factory=lambda: _env("QUALITY_RUNNER_S3_ACCESS_KEY"))
    artifact_s3_secret_key: str = field(default_factory=lambda: os.getenv("QUALITY_RUNNER_S3_SECRET_KEY", ""))
    artifact_retention_days: int = field(default_factory=lambda: _int_env("QUALITY_RUNNER_ARTIFACT_RETENTION_DAYS", 30))
    evidence_hash_key: str = field(default_factory=lambda: os.getenv("QUALITY_RUNNER_EVIDENCE_HASH_KEY", ""))

    def validate(self) -> None:
        environment = self.environment.strip().lower()
        if environment not in {"development", "test", "production"}:
            raise ValueError("QUALITY_RUNNER_ENV must be development, test or production")
        if self.max_concurrency < 1 or self.max_concurrency > 32:
            raise ValueError("QUALITY_RUNNER_MAX_CONCURRENCY must be between 1 and 32")
        if self.max_concurrency_per_tenant < 1 or self.max_concurrency_per_tenant > self.max_concurrency:
            raise ValueError("QUALITY_RUNNER_MAX_CONCURRENCY_PER_TENANT is invalid")
        if self.timeout_seconds < 30 or self.timeout_seconds > 86_400:
            raise ValueError("QUALITY_RUNNER_TIMEOUT_SECONDS must be between 30 and 86400")
        if self.evidence_limit < 1 or self.evidence_limit > 20:
            raise ValueError("QUALITY_RUNNER_EVIDENCE_LIMIT must be between 1 and 20")
        if self.artifact_retention_days < 1 or self.artifact_retention_days > 3650:
            raise ValueError("QUALITY_RUNNER_ARTIFACT_RETENTION_DAYS must be between 1 and 3650")
        if self.auth_mode == "ENFORCED" and (not self.oidc_issuer or not self.oidc_audience):
            raise ValueError("OIDC issuer and audience are required when auth is enforced")
        if not self.db_url or "://" not in self.db_url:
            raise ValueError("QUALITY_RUNNER_DB_URL must be a SQLAlchemy URL")
        if not self.project_dir or not self.profiles_dir:
            raise ValueError("dbt project and profiles directories are required")
        if environment == "production" and self.auth_mode != "ENFORCED":
            raise ValueError("production quality runner requires OIDC authentication")
        if environment == "production" and not self.oidc_issuer.lower().startswith("https://"):
            raise ValueError("production quality runner OIDC issuer must use HTTPS")
        if environment == "production" and len(self.evidence_hash_key.encode("utf-8")) < 16:
            raise ValueError("production quality runner requires a dedicated evidence HMAC key")
        if environment == "production" and (
                not self.doris_host or not self.doris_user or not self.doris_password
                or not self.doris_dbt_user or not self.doris_dbt_password
                or not self.doris_cleanup_user or not self.doris_cleanup_password):
            raise ValueError("production quality runner requires Doris query, dbt audit and cleanup credentials")
        if environment == "production" and (
                not self.artifact_s3_endpoint or not self.artifact_s3_bucket
                or not self.artifact_s3_access_key or not self.artifact_s3_secret_key):
            raise ValueError("production quality runner requires RustFS/S3 artifact storage")


settings = Settings()
