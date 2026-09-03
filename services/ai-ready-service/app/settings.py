"""运行配置（环境变量，见 deploy/dev/docker-compose.yml 的 ai-ready-service 段）。

口令类只经环境注入，永不写入日志与评估产物。Doris 账号沿用只读的
dataos_om_ro（三库 SELECT，与 OM 摄取同面）。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass(frozen=True)
class Settings:
    # 声明仓库（容器内挂载点）：profiles / requirements / policies
    repo_dir: str = field(default_factory=lambda: _env("AI_READY_REPO_DIR", "/opt/dataos/ai-ready"))

    # Doris 只读检查面
    doris_host: str = field(default_factory=lambda: _env("DORIS_FE_HOST"))
    doris_port: int = field(default_factory=lambda: int(_env("DORIS_FE_PORT", "9030")))
    doris_user: str = field(default_factory=lambda: _env("DORIS_USER", "dataos_om_ro"))
    doris_password: str = field(default_factory=lambda: _env("DORIS_PASSWORD"))
    doris_connect_timeout_s: float = field(default_factory=lambda: float(_env("DORIS_CONNECT_TIMEOUT_S", "5")))
    # 构建写入面（G10）：与评估只读面分离，仅 dataos_ai 库写权
    doris_writer_user: str = field(default_factory=lambda: _env("DORIS_WRITER_USER", "dataos_ai_writer"))
    doris_writer_password: str = field(default_factory=lambda: _env("DORIS_WRITER_PASSWORD"))

    # OpenMetadata 读取面（client credentials 自签令牌）
    om_base_url: str = field(default_factory=lambda: _env("AI_READY_OM_BASE_URL"))
    om_token_uri: str = field(default_factory=lambda: _env("AI_READY_OM_TOKEN_URI"))
    om_client_id: str = field(default_factory=lambda: _env("AI_READY_OM_CLIENT_ID"))
    om_client_secret: str = field(default_factory=lambda: _env("AI_READY_OM_CLIENT_SECRET"))

    # 服务间认证：优先 OIDC（issuer 非空启用 JWKS 验签）；否则共享静态令牌。
    oidc_issuer: str = field(default_factory=lambda: _env("AI_READY_OIDC_ISSUER"))
    oidc_audience: str = field(default_factory=lambda: _env("AI_READY_OIDC_AUDIENCE", "dataos-ai-ready"))
    # JWKS 直连（S7）：issuer 为网关自签 HTTPS 时从内网 Keycloak 直取；空值走
    # issuer discovery（其 verify=False 仅为网关自签的 dev 兜底）。
    oidc_jwks_uri: str = field(default_factory=lambda: _env("AI_READY_OIDC_JWKS_URI"))
    api_token: str = field(default_factory=lambda: _env("AI_READY_API_TOKEN"))

    def validate(self) -> None:
        if not os.path.isdir(self.repo_dir):
            raise RuntimeError(f"AI Ready 声明仓库不存在：{self.repo_dir}")
        if not self.doris_host:
            raise RuntimeError("缺少 DORIS_FE_HOST（只读评估面）")
        if not self.om_base_url:
            raise RuntimeError("缺少 AI_READY_OM_BASE_URL（元数据探针）")
        if not self.oidc_issuer and not self.api_token:
            raise RuntimeError("认证未配置：需要 AI_READY_OIDC_ISSUER 或 AI_READY_API_TOKEN")


settings = Settings()
