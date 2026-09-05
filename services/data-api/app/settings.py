"""执行面配置：控制面 registry 回源、Doris 只读查询面。

dev 口径与 ai-ready-service 同姿势：OIDC 未配置时可用静态内部令牌。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class Settings:
    controlplane_base_url: str = field(
        default_factory=lambda: os.environ.get("CONTROL_PLANE_BASE_URL", "http://control-plane:8080"))
    oidc_token_uri: str = field(
        default_factory=lambda: os.environ.get("DATA_API_OIDC_TOKEN_URI",
                                               "https://172.16.65.59:8443/auth/realms/data-platform/protocol/openid-connect/token"))
    oidc_client_id: str = field(default_factory=lambda: os.environ.get("DATA_API_OIDC_CLIENT_ID", ""))
    oidc_client_secret: str = field(default_factory=lambda: os.environ.get("DATA_API_OIDC_CLIENT_SECRET", ""))
    internal_token: str = field(default_factory=lambda: os.environ.get("DATA_API_INTERNAL_TOKEN", ""))
    doris_host: str = field(default_factory=lambda: os.environ.get("DORIS_HOST", "172.16.66.8"))
    doris_port: int = field(default_factory=lambda: int(os.environ.get("DORIS_PORT", "9030")))
    doris_user: str = field(default_factory=lambda: os.environ.get("DORIS_USER", "dataos_api_ro"))
    doris_password: str = field(default_factory=lambda: os.environ.get("DORIS_PASSWORD", ""))
    doris_connect_timeout_s: int = field(
        default_factory=lambda: int(os.environ.get("DORIS_CONNECT_TIMEOUT_S", "5")))
    registry_ttl_s: int = field(default_factory=lambda: int(os.environ.get("REGISTRY_TTL_S", "30")))
    audit_timeout_s: float = field(default_factory=lambda: float(os.environ.get("AUDIT_TIMEOUT_S", "2.0")))
    # ---- P8（H3）：stale-grace / 熔断 / 审计持久缓冲 ----
    registry_grace_s: int = field(default_factory=lambda: int(os.environ.get("REGISTRY_GRACE_S", "300")))
    breaker_failure_threshold: int = field(default_factory=lambda: int(os.environ.get("BREAKER_FAILURE_THRESHOLD", "5")))
    breaker_open_seconds: float = field(default_factory=lambda: float(os.environ.get("BREAKER_OPEN_SECONDS", "30")))
    audit_buffer_path: str = field(default_factory=lambda: os.environ.get(
        "AUDIT_BUFFER_PATH", "/var/lib/dataos-data-api/audit-buffer.jsonl"))
    audit_replay_interval_s: int = field(default_factory=lambda: int(os.environ.get("AUDIT_REPLAY_INTERVAL_S", "30")))
    audit_max_age_hours: int = field(default_factory=lambda: int(os.environ.get("AUDIT_MAX_AGE_HOURS", "72")))
    # ---- 异步导出（P7，H3）----
    export_max_rows: int = field(default_factory=lambda: int(os.environ.get("EXPORT_MAX_ROWS", "1000000")))
    export_timeout_s: int = field(default_factory=lambda: int(os.environ.get("EXPORT_TIMEOUT_S", "600")))
    export_concurrency: int = field(default_factory=lambda: int(os.environ.get("EXPORT_CONCURRENCY", "2")))
    export_retention_days: int = field(default_factory=lambda: int(os.environ.get("EXPORT_RETENTION_DAYS", "7")))
    # 对象存储（RustFS artifacts 模式的第二消费者；四件套缺省时退化为本地目录）
    s3_endpoint: str = field(default_factory=lambda: os.environ.get("DATA_API_S3_ENDPOINT", ""))
    s3_bucket: str = field(default_factory=lambda: os.environ.get("DATA_API_S3_BUCKET", "dataos-data-api-exports"))
    s3_region: str = field(default_factory=lambda: os.environ.get("DATA_API_S3_REGION", "us-east-1"))
    s3_access_key: str = field(default_factory=lambda: os.environ.get("DATA_API_S3_ACCESS_KEY", ""))
    s3_secret_key: str = field(default_factory=lambda: os.environ.get("DATA_API_S3_SECRET_KEY", ""))
    export_dir: str = field(default_factory=lambda: os.environ.get("DATA_API_EXPORT_DIR", "/tmp/dataos-data-api-exports"))

    def validate(self) -> None:
        if not self.doris_password:
            raise SystemExit("DORIS_PASSWORD 未配置（dataos_api_ro 只读账号口令）")
        if not (self.oidc_client_id and self.oidc_client_secret) and not self.internal_token:
            raise SystemExit("服务间认证未配置：OIDC client 或 DATA_API_INTERNAL_TOKEN 至少一项")
        if self.export_max_rows < 1 or self.export_timeout_s < 1 or self.export_concurrency < 1:
            raise SystemExit("导出参数非法（EXPORT_MAX_ROWS / EXPORT_TIMEOUT_S / EXPORT_CONCURRENCY 须 ≥ 1）")
