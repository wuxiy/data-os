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
| 控制面 → MPI 投影（运营指标） | `dataos-control-plane-mpi` | `data-os-mpi` | —（读侧走 realm 角色 viewer） | `DATAOS_OPERATIONS_MPI_OIDC_CLIENT_ID/SECRET/AUDIENCE`、`DATAOS_OPERATIONS_MPI_OIDC_TOKEN_URI` | mpi 验签+aud+角色（GET 读侧）+**租户 claims**（TenantScope 缺任一 403） |
| Data API 出站（OM/Superset 指标投影） | `dataos-data-api` | **registry 回链 `data-os`（种子装配，B3）**；OM/Superset 侧由被调方决定 | — | `DATA_API_OIDC_CLIENT_ID/SECRET` | 出站调用验签在被调方；**registry 回链（控制面 /internal）受全局 aud=data-os 校验** |
| AI Ready → OM 摄取 | `dataos-om-ingest` | OM 侧 jwtToken 配置 | — | `AI_READY_OM_CLIENT_ID/SECRET`（服务容器内） | OM 1.6 只收 jwtToken（H1） |
| DolphinScheduler（调度/编排） | DS 自有 token（非 OIDC） | — | — | `DOLPHINSCHEDULER_BASE_URL`+token 轮转器 | DS header token + 轮转（deploy/*/scheduler-token-rotator） |

被调方监听键：runner `QUALITY_RUNNER_AUTH_MODE/OIDC_ISSUER/OIDC_AUDIENCE`（ENFORCED 默认）；引擎 `AI_READY_OIDC_ISSUER/AUDIENCE/JWKS_URI`；Data API `DATA_API_RESOURCE_ISSUER/AUDIENCE/JWKS_URI`；MPI `DATAOS_MPI_AUTH_MODE/OIDC_ISSUER_URI/AUDIENCE`（audience=data-os-mpi）+ `DATAOS_MPI_OIDC_JWK_SET_URI`（S7 同款 JWKS 直连，B 组）。

## 三、JWKS 直连（S7 模式）

issuer 为网关自签 HTTPS 时，验签方从内网 Keycloak 直取 JWKS（`http://keycloak:8080/.../certs`），iss 声明仍按网关值校验：控制面 `DATAOS_OIDC_JWK_SET_URI`、runner `QUALITY_RUNNER_OIDC_JWKS_URI`、引擎 `AI_READY_OIDC_JWKS_URI`、Data API `DATA_API_RESOURCE_JWKS_URI`、MPI `DATAOS_MPI_OIDC_JWK_SET_URI`（B 组补齐，四服务+MPI 全覆盖）。

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
MPI_CLIENT_ID=dataos-control-plane-mpi MPI_CLIENT_SECRET=<同 .env> \
deploy/scripts/auth-smoke.sh
```

新 client 的 secret 缺省时种子生成并**仅创建时回显一次**；操作员同步写入 `.env`（唯一属主）。

## 五、当前模式与已验证状态（2026-10-05，B 组收口后）

- **dev**：常设 DISABLED（门户免登录迭代）；**ENFORCED 整链已窗口式验证并回退**（B 组 B1，2026-10-05：PKCE 登录 + 三服务同开 + 六链冒烟 + 问数/质量推送/MPI 双链真执行，见 [validation/gate-g2g-b-group-auth-20261005.md](validation/gate-g2g-b-group-auth-20261005.md)）；重开配方 = `.env` 翻三键 + 登录门 dist（gate §二）。
- **生产**：控制面 ENFORCED + 门户 PKCE（H3 实证）；服务间种子步骤已固化进 [production/README.md](production/README.md#服务间链生产上线必跑的第二颗种子)，且顺序（门户种子→服务间种子→冒烟→ENFORCED）在全新 Keycloak 26 实例空跑验证（B3）。

## 六、已知边界（原 B 组三项已于 2026-10-05 全部关闭）

1. ~~dev 切 ENFORCED 整链验证~~ → 完成（窗口式，含两处实抓缺陷修复；长期保持 ENFORCED 为独立姿势决策，配方见 gate §二）。
2. ~~控制面→MPI 投影 OIDC client~~ → 完成（消费代码 + 种子 + 冒烟 + dev 真链）。
3. ~~生产 realm 服务间种子~~ → 固化（README 步骤 + 全新 KC26 空跑彩排六链全绿；生产上线时按 §四 执行即下）。
4. 遗留：ai-ready→控制面投影仍公开端点直读（ENFORCED 下退化，G23 候选②归 H4/H5）；门户用户 token 为多 aud（data-os + data-os-mpi，portal seed 默认配）。
