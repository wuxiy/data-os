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

    def validate(self) -> None:
        if not self.doris_password:
            raise SystemExit("DORIS_PASSWORD 未配置（dataos_api_ro 只读账号口令）")
        if not (self.oidc_client_id and self.oidc_client_secret) and not self.internal_token:
            raise SystemExit("服务间认证未配置：OIDC client 或 DATA_API_INTERNAL_TOKEN 至少一项")
