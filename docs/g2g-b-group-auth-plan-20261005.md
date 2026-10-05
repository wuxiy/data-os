# G2G B 组三项执行计划（认证收口余项）

> 裁决：用户 2026-10-05 明示「完成 B 组三项」。三项出自
> [deploy-auth-matrix.md](deploy-auth-matrix.md) §六 与 backlog 2026-10-05 条目：
> B1 dev 切 ENFORCED 整链验证；B2 控制面→MPI 投影补 OIDC client 消费代码；
> B3 生产 realm 服务间种子固化。执行顺序 **B2 → B1 → B3**（B1 的 MPI ENFORCED
> 依赖 B2 的调用侧凭据）。

## B2 控制面 → MPI 投影 OIDC 化

现状：`HttpMpiFactsClient` 裸 GET `/api/v1/mpi/metrics`（dev DISABLED 直连）；
mpi-service 解码器只走 `JwtDecoders.fromIssuerLocation`——issuer 为网关自签
HTTPS 时 discovery 取 JWKS 会炸，缺 S7 的内网 JWKS 直连旁路（H2 记的
「接线配方一行」，当时因「无现实通道」延后）。

改动面：

1. **控制面**（行为保持：未配置凭据不发 Authorization 头，DISABLED 直连零变化）
   - `HttpMpiFactsClient` 增 `OidcClientCredentialsTokenProvider`（样板 =
     `AssistantDataApiClient`/`EdgeWatermarkClient`：AdapterHttp 强制 HTTP/1.1、
     惰性 Bearer、30s 前置过期的短缓存 token）；
   - 新配置键 `data-os.operations.mpi.oidc.{token-uri,client-id,client-secret,audience}`
     （env `DATAOS_OPERATIONS_MPI_OIDC_*`，audience 默认 `data-os-mpi`）。
2. **mpi-service**：`AuthProperties` 增 `jwkSetUri`（env
   `DATAOS_MPI_OIDC_JWK_SET_URI`），`jwtDecoder` 分支——配置了 jwk-set-uri 时
   `NimbusJwtDecoder.withJwkSetUri` 直取内网 JWKS，iss 校验（`JwtIssuerValidator`）
   保留按 issuer-uri 网关值；语义与 control-plane S7 完全一致。
3. **种子脚本**（`deploy/scripts/keycloak-service-seed.sh`）增第 4 节：
   client `dataos-control-plane-mpi`（env `MPI_CLIENT_ID/SECRET` 可覆写）：
   - audience mapper `data-os-mpi`（含 `access.token.claim:true`——KC26 不带
     此键 mapper 静默不生效，B7 实测坑）；
   - service account + **realm 角色 `viewer`**——MPI ENFORCED 的读侧规则
     `GET /api/v1/mpi/**` 允许 viewer，是只读投影的最小角色；角色本身幂等
     自建（未跑 portal seed 的 realm 也能用）。
4. **冒烟脚本**（`auth-smoke.sh`）增 MPI 链：aud=data-os-mpi +
   `realm_access.roles` 含 viewer（复刻 mpi `authorities()` 的取角色口径）。
5. dev compose：控制面服务挂 `DATAOS_OPERATIONS_MPI_OIDC_*` 四键；mpi 服务挂
   `DATAOS_MPI_OIDC_JWK_SET_URI`（内网 certs 直连）。

测试：控制面 `HttpMpiFactsClientTest`（HttpServer 桩：配置凭据→带 Bearer 且
token 端点被调；不配置→无 Authorization 头直连 200——行为保持负例）；mpi
`OidcSecurityConfiguration` 单测（jwk-set-uri 在位时 decoder 无网络可构造；
blank 时保留既有守卫异常）。

## B1 dev 切 ENFORCED 整链验证

**性质**：运行策略变更窗口（用户已裁决），验证后**回退 dev 站位 DISABLED**
——dev 的常设职责是免登录迭代（矩阵 §五 dev=DISABLED）；「长期保持
ENFORCED」是独立姿势决策，回退后配方仍是一段 env（记录于 gate 文档）。

Flip 矩阵（远程 .env，全部可逆）：

| 服务 | 键 | 验证值 |
| --- | --- | --- |
| control-plane | `DATAOS_AUTH_MODE` | ENFORCED（issuer/JWKS/audience 已在 compose 默认） |
| mpi-service | `DATAOS_MPI_AUTH_MODE` | ENFORCED + `DATAOS_MPI_OIDC_ISSUER_URI`=网关值 + `DATAOS_MPI_OIDC_JWK_SET_URI`=内网 certs |
| quality-runner | `QUALITY_RUNNER_AUTH_MODE` | ENFORCED + `QUALITY_RUNNER_OIDC_ISSUER`=网关值 + `QUALITY_RUNNER_OIDC_JWKS_URI`=内网 certs |
| ai-ready / data-api | — | 不动（ai-ready issuer 非空已 ENFORCED；data-api internal 面常设 ENFORCED） |
| 门户 | dist 构建 | 带 OIDC 登录门（H3 配方：issuer 网关值 + client `data-os-portal` + redirect `http://localhost:18081/`——localhost HTTP 是 secure context，PKCE 可完成） |

门户登录链材料已核实在位（dev KC realm：`data-os-portal` 公共 client S256、
七角色、`portal-demo` 用户）；验证前重置 portal-demo 口令（`--reset-demo-password`）
并临时加 `platform-admin` 角色（驾驶舱 `/api/v1/platform-operations/**` 需要；
结束后移除）。

验证清单：

1. 冒烟全绿（六链含新 MPI 链）；
2. 负例：control-plane `/api/v1/operations` 无 token 401；mpi metrics 无 token
   401、aud=account 401；
3. 浏览器（headless Chrome 忽略自签证书 + ssh 隧道 localhost:18081）：PKCE
   登录 → 驾驶舱（MPI 卡走控制面→mpi OIDC 真链）→ 质量规则保存（控制面→runner
   OIDC 推送）→ AI Data 概览（控制面→ai-ready）→ 问数（控制面→data-api
   internal）；
4. data-api→control面 registry 回链（internal 面本就 ENFORCED，S8 已验，抽一条
   X-API-Key 查询确认不回归）；
5. 回退：三键回 DISABLED、无门 dist 复发（bundle 无 8443/realms 串守卫）、
   portal 重启、免登录冒烟页面复活。

## B3 生产 realm 服务间种子固化

生产 Keycloak 尚未存在（生产 compose 不含 KC，README 只写了门户种子）。

1. `deploy/production/README.md` 增「服务间种子」步骤：对照矩阵 §四，含
   六个 client 的 secret 属主纪律（.env 唯一属主、仅创建时回显）与冒烟命令；
2. **全新 KC 空跑彩排**（证明脚本对干净 realm 可用，不依赖 dev realm 的
   H2 期手工遗产）：dev 主机起一次性 KC 容器（独立端口/realm 名）→
   portal-seed（realm 角色 + 公共 client + demo user）→ service-seed（六
   client）→ auth-smoke 全链 → 拆除。彩排结果入 gate 文档。

## 验收与收口

- 双端测试全绿（control-plane / mpi-service），行为保持型改动零既有测试修改；
- gate 文档 `docs/validation/gate-g2g-b-group-auth-20261005.md`；
- matrix §五/§六 更新（B 组三项状态）、backlog 关账、英文提交推 main、记忆底账。
