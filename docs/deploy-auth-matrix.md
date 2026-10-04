# data-os 认证矩阵（G2G 批次 7 交付）

> 统一认证的可运维一览：每条链路的调用方/被调方、client、scope、audience、env 键与当前模式。种子与冒烟：`deploy/scripts/keycloak-service-seed.sh` / `auth-smoke.sh`。账号与凭据的来源记录见 [environment-access-reference.md](environment-access-reference.md)（不含秘密值；真实值只在开发机/生产 `.env`，`0600`）。

## 一、门户用户链（浏览器 → 门户 → 控制面）

| 项 | 值 |
| --- | --- |
| 协议 | OIDC Authorization Code + PKCE（门户 SPA 公共 client） |
| 种子 | `deploy/production/scripts/keycloak-portal-seed.sh`（7 realm 角色 + portal client + audience/租户 mapper + 演示用户） |
| realm 角色 | platform-admin / tenant-admin / platform-operator / data-engineer / data-governance / data-analyst / viewer |
| 控制面入口鉴权 | `data-os.auth.mode`（`DATAOS_AUTH_MODE`）；dev=DISABLED，生产=ENFORCED；DISABLED 下 `/internal/**` 仍独立强制（S8） |
| 门户角色判定 | token roles claim → 技术域（data-engineer/platform-operator/platform-admin）、问数治理（另含 tenant-admin/data-governance） |

## 二、服务间链（client_credentials，RS256）

| 链路 | client（默认名） | audience | scope | 控制面 env（调用侧） | 被调方校验要点 |
| --- | --- | --- | --- | --- | --- |
| 控制面 → 质量执行器（规则推送/水位代理） | `dataos-control-plane-quality` | `dataos-quality-runner` | quality:submit、quality:read、**quality:admin** | `DATAOS_QUALITY_OIDC_CLIENT_ID/SECRET/AUDIENCE`、`DATAOS_QUALITY_OIDC_TOKEN_URI` | runner 验签+aud+scope claim+**tenant_id/institution_id claims**（缺任一 403） |
| 控制面 → AI Ready 引擎（构建/评估） | `dataos-ai-ready` | `dataos-ai-ready` | — | `DATAOS_AI_READY_OIDC_CLIENT_ID/SECRET/TOKEN_URI` | 引擎验签+aud+iss（exp/iat/sub） |
| 控制面 → Data API 问数（internal） | `dataos-assistant-bff` | `dataos-data-api` | — | `DATAOS_ASSISTANT_OIDC_CLIENT_ID/SECRET/AUDIENCE` | 资源侧验签+aud+iss（internal 面 fail-closed，G26） |
| Data API 出站（OM/Superset 指标投影） | `dataos-data-api` | 被调方决定 | — | `DATA_API_OIDC_CLIENT_ID/SECRET` | 出站调用，验签在被调方 |
| AI Ready → OM 摄取 | `dataos-om-ingest` | OM 侧 jwtToken 配置 | — | `AI_READY_OM_CLIENT_ID/SECRET`（服务容器内） | OM 1.6 只收 jwtToken（H1） |
| DolphinScheduler（调度/编排） | DS 自有 token（非 OIDC） | — | — | `DOLPHINSCHEDULER_BASE_URL`+token 轮转器 | DS header token + 轮转（deploy/*/scheduler-token-rotator） |

被调方监听键：runner `QUALITY_RUNNER_AUTH_MODE/OIDC_ISSUER/OIDC_AUDIENCE`（ENFORCED 默认）；引擎 `AI_READY_OIDC_ISSUER/AUDIENCE/JWKS_URI`；Data API `DATA_API_RESOURCE_ISSUER/AUDIENCE/JWKS_URI`；MPI `DATAOS_MPI_AUTH_MODE/OIDC_ISSUER_URI/AUDIENCE`（audience=data-os-mpi）。

## 三、JWKS 直连（S7 模式）

issuer 为网关自签 HTTPS 时，验签方从内网 Keycloak 直取 JWKS（`http://keycloak:8080/.../certs`），iss 声明仍按网关值校验：控制面 `DATAOS_OIDC_JWK_SET_URI`、runner `QUALITY_RUNNER_OIDC_JWKS_URI`、引擎 `AI_READY_OIDC_JWKS_URI`、Data API `DATA_API_RESOURCE_JWKS_URI`。

## 四、种子与冒烟

```bash
# 种子（幂等：在位 client 只补缺失件，不重建不换 secret）
KEYCLOAK_ADMIN_URL=http://keycloak:8080/auth \
KEYCLOAK_ADMIN_USER=... KEYCLOAK_ADMIN_PASSWORD=... SEED_REALM=data-platform \
QUALITY_CLIENT_SECRET=<预生成，写入 .env 的同一值> \
deploy/scripts/keycloak-service-seed.sh

# 冒烟（完整复刻被调方验签+claims 检查，不需要被调服务在线）
OIDC_TOKEN_URI=http://keycloak:8080/auth/realms/data-platform/protocol/openid-connect/token \
QUALITY_CLIENT_ID=dataos-control-plane-quality QUALITY_CLIENT_SECRET=<同 .env> \
AI_READY_CLIENT_ID=dataos-ai-ready AI_READY_CLIENT_SECRET=<同 .env> \
ASSISTANT_CLIENT_ID=dataos-assistant-bff ASSISTANT_CLIENT_SECRET=<同 .env> \
deploy/scripts/auth-smoke.sh
```

新 client 的 secret 缺省时种子生成并**仅创建时回显一次**；操作员同步写入 `.env`（唯一属主）。

## 五、当前模式与已验证状态（2026-10-05）

- **dev**：全部服务 auth=DISABLED（门户免登录）；OIDC 服务间链的 token 侧正确性由冒烟证明（种子+冒烟 dev 实测，含 quality:admin 断言——批次 2 欠账关闭）；**切 ENFORCED 属运行策略变更，须用户裁决**（见 backlog）。
- **生产**：控制面 ENFORCED + 门户 PKCE（H3 实证）；服务间链路种子后按本矩阵核对 `.env`。

## 六、已知边界（backlog 承载）

1. dev 切 ENFORCED 的整链验证（门户登录 + 服务间同开）——策略变更，用户裁决。
2. 控制面 → MPI 投影（`HttpMpiFactsClient`）当前无 OIDC client 消费代码（dev DISABLED 直连）；MPI ENFORCED 前须补调用侧凭据，本批不预造无消费者的 client。
3. 生产 realm 的服务间种子尚未在生产 Keycloak 执行（脚本 dev/prod 通用；生产上线时按第四节操作）。
