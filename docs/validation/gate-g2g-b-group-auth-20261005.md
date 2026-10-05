# G2G B 组三项收口验收（认证统一余项）

> 裁决：用户 2026-10-05 明示「完成 B 组三项」。范围与顺序（B2→B1→B3）、
> 设计取舍见 [docs/g2g-b-group-auth-plan-20261005.md](../g2g-b-group-auth-plan-20261005.md)。
> 三项出自 [deploy-auth-matrix.md](../deploy-auth-matrix.md) §六：
> ① dev 切 ENFORCED 整链验证；② 控制面→MPI 投影 OIDC client；③ 生产 realm
> 服务间种子固化。本批共实抓并修复 **三处真实缺口**，全部先在真环境复现、
> 后修种子/配置、再复验通过。

## 一、B2：控制面 → MPI 投影 OIDC 化（提交 136e131 + a5f167d）

代码面（双端测试全绿：control-plane 339/339、mpi-service 62+1 既有跳过）：

- `HttpMpiFactsClient` 挂 `OidcClientCredentialsTokenProvider`（惰性 Bearer、
  30s 前置过期缓存；新键 `data-os.operations.mpi.oidc.*`，audience 默认
  `data-os-mpi`）；**凭据空时不发 Authorization 头——DISABLED 直连零变化**
  （HttpMpiFactsClientTest 正反两例锁定）；
- mpi-service 补 S7 同款 JWKS 直连旁路（`DATAOS_MPI_OIDC_JWK_SET_URI`）：
  issuer 为网关自签 HTTPS 时 discovery 取 JWKS 会失败，直连内网 certs、
  iss 声明仍按网关值校验（H2 记的「接线配方一行」落账；
  OidcSecurityConfigurationTest 四例）；
- 种子脚本第六 client `dataos-control-plane-mpi`：aud mapper（含
  `access.token.claim:true`）+ service account + **realm 角色 viewer**
  （`GET /api/v1/mpi/**` 读侧最小角色，角色幂等自建）；
- 冒烟脚本增 MPI 链断言（aud + realm_access.roles + 租户 claims）。

**dev 实测缺陷 #1（TenantScope 403）**：MPI ENFORCED 首翻，token 的
aud/iss/role 全对仍 403。本地 probe 证明 `authorities()` 逻辑正确，拒绝路径
锁定 `TenantScope.resolve`——ENFORCED 下缺 `tenant_id/institution_id` claims
即 403，而种子没给 MPI client 抄 quality client 的硬编码租户 mapper。修复 =
种子补两只 claim mapper（a5f167d），冒烟同步加 tenant 断言。复验：投影
`{availability: "UP", reviewPending: 1128}`。

DISABLED 行为保持：新镜像（0.2.0-authb-20261005 双镜像）部署后匿名直连
口径不变（MPI 卡 UP 真数据）；控制面凭据已接线后即使 mpi DISABLED 也只是
多发一个被忽略的 Bearer。

## 二、B1：dev 切 ENFORCED 整链验证（窗口式，已回退）

**姿势裁决**：验证窗口结束后回退 dev 站位 DISABLED（dev 常设职责是免登录
迭代；长期 ENFORCED 是独立姿势决策）。**重开配方**：`.env` 追加
`DATAOS_AUTH_MODE=ENFORCED` + `DATAOS_MPI_AUTH_MODE=ENFORCED` +
`DATAOS_MPI_OIDC_ISSUER_URI=<网关 issuer>` + `QUALITY_RUNNER_AUTH_MODE=ENFORCED`
+ `QUALITY_RUNNER_OIDC_ISSUER/JWKS_URI`，门户换登录门 dist（见下），`docker
compose up -d` 三服务；ai-ready（issuer 非空即 ENFORCED）与 data-api
internal 面不动。

验证清单（全过）：

| # | 项 | 证据 |
| --- | --- | --- |
| 1 | 六链冒烟（含新 MPI 链） | 全 PASS（iss=网关值断言） |
| 2 | 负例 ×3 | control-plane `/operations/summary` 401、runner 规则端点 PUT 无 token 401、mpi metrics 401（JSON problem 体） |
| 3 | PKCE 浏览器登录 | 真实 KC 登录页（S256 challenge）→ 回调 → token 交换；登录态 token `aud=[data-os-mpi,data-os,account]`、roles 含 platform-admin/viewer、租户 claims 齐 |
| 4 | 五页渲染 | 运营中心（MPI 卡 UP/1128）/ 质量 / AI Data / 问数 / MPI 复核直连页全部 ok、无 401 打回门 |
| 5 | 问数全链 ANSWERED | 用户 token → 控制面 ENFORCED → assistant client（OIDC）→ data-api internal ENFORCED → Doris 真数据 + 审计落库（auditId 留痕） |
| 6 | 质量规则推送 | 用户 token PUT 规则 200 + DELETE 204（控制面→runner OIDC 推送编译成功） |
| 7 | MPI 双链 | 服务 token 投影 UP + 用户 token 直连 metrics 200（2882 身份真数据） |

截图证据：`g2g-b-group-01-login-gate.png`（登录门）、`02-kc-login-page.png`
（KC 授权页）、`04-operations-mpi-card.png`（登录态驾驶舱）、
`08-mpi-review.png`（MPI 复核直连页）。

**dev 实测缺陷 #2（门户直连 MPI 缺 aud）**：mpi-review 页打回登录门——门户
`portalFetch('/v1/mpi/...')` 由 nginx 直达 mpi-service，用户 token 只带
`aud=data-os`，mpi 的 AudienceValidator 拒收。dev 此前 mpi 恒 DISABLED 从未
暴露。修复 = portal seed 给 `data-os-portal` 增第二只 audience mapper
（`PORTAL_MPI_AUDIENCE` 可禁用），门户用户 token 成为多 aud（与服务 client
同型）。

**dev 实测缺陷 #3（质量推送 token-uri 从未接线）**：规则保存被 runner 拒
（`Bearer token required`）——dev `.env` 一直只有 quality client-id/secret，
token-uri 空（runner 恒 DISABLED 掩盖）。修复 = dev compose 给
`DATAOS_QUALITY_OIDC_TOKEN_URI/CLIENT_ID` 内网默认值（与 assistant/ai-ready
同风格，secret 仍归 .env）。

**已知边界（ENFORCED 窗口内）**：ai-ready 的 `fhir_mapping_coverage` 检查走
控制面公开投影端点（G23 候选②），ENFORCED 下会 401 退化——窗口内未跑评估
未触发；归 H4/H5 鉴权矩阵既有候选，不新增。

**浏览器工程事实**：ZCode IAB webview 与默认 headless Chrome 的 fetch 均无法
绕 KC 网关自签证书（discovery 拿到错误页 HTML，SPA 报「Unexpected token
'<'」）；本批以自驱 headless Chrome（`--ignore-certificate-errors` +
原生 WebSocket CDP）完成登录与逐页核验。另：**portal-dist 是 bind mount 咬
原 inode**——`mv` 换目录后容器仍服务旧内容，热更必须原位覆写（rm 内容 +
原目录解包）；Chrome 还会缓存 index.html，验证脚本须 `setCacheDisabled`。

**回退记录**：`.env` 自 `.env.bak-bgroup-20261005` 复原（MPI secret/镜像 tag
保留）、三服务 DISABLED 重建、无门 dist 原位覆写（bundle 无
`realms/data-platform` 串，守卫 0 命中）、portal 重启、portal-demo 摘除临时
platform-admin（回到 viewer）。复原后匿名面全 200。

## 三、B3：生产 realm 服务间种子固化

1. **`deploy/production/README.md` 增「服务间链」章节**：完整上线顺序
   （门户种子 → 服务间种子 → 冒烟 → ENFORCED 拉起）、secret 属主纪律、
   KC26 partial PUT 警告（见缺陷 #4）、MPI 双 aud 口径；
2. **全新 Keycloak 26 空跑彩排**（dev 主机一次性容器 + 独立 realm，拆于
   验后）：

| 步骤 | 结果 |
| --- | --- |
| 建容器 + realm | `data-platform` 201 |
| portal seed（含 demo 用户） | client/双 audience mapper/租户 mapper/user 全建 |
| service seed | 六 client 全新装配（scope/aud/租户 claims/角色） |
| 操作员设 secret | 六 client 读-改-写全量 PUT |
| auth-smoke 六链 | **全 PASS**（iss=彩排实例自身） |
| 种子二跑 | 零变更（幂等证明） |

**彩排实抓缺陷 #4（data-api registry 回链缺 aud）**：全新 realm 上
`dataos-data-api` 无人配 `aud=data-os` mapper——dev 靠 H2 时代手工遗产
（mapper 名 `aud-data-os`）撑着 registry 回链（控制面 `/internal/data-api/**`
全局 audience 校验），照种子上生产会 401 → data-api 503
REGISTRY_UNAVAILABLE。修复 = service seed 对 data-api 强制装配
`aud=data-os` mapper（B1 窗口内问数 ANSWERED 恰好是靠 dev 的遗产 mapper
通过的，彩排才暴露此依赖）；冒烟 data_api 链同步加 aud 断言。

**KC26 新坑（工程事实）**：对 `PUT /clients/{id}` 发 partial body（只带
`secret`）→ client 实体存活但 **service account 用户被孤儿化、角色映射丢失**
（与 H2「users PUT 整实体替换」同族）。种子自身的 PUT 全部是 GET 全量 →
改 → PUT 回（不受影响）；运维侧设 secret 必须走管理台或同款读改写
（README 已记）。

彩排拆除：容器删除、临时口令/secret 文件清零。dev realm 同步吃进
data-api aud 补件（幂等）+ 冒烟复跑关键链全 PASS。

## 四、测试与提交

- control-plane 339/339、mpi-service 62（1 个既有 drift 门控跳过）；
- 提交链：`136e131`（B2 主体）→ `a5f167d`（TenantScope 租户 claims 修复）→
  本 gate 提交（portal 双 aud / quality token-uri 默认 / data-api aud /
  README / matrix / backlog）；
- dev 运行态：control-plane + mpi-service 镜像 `0.2.0-authb-20261005`，
  DISABLED 姿势，MPI OIDC 凭据常接线（后续切 ENFORCED 只需翻模式键）。

## 五、遗留与候选

1. dev 长期保持 ENFORCED（生产姿势镜像）——独立裁决项，配方已固化（§二）；
2. ai-ready→控制面投影的带角色 token（G23 候选②，ENFORCED 窗口会退化）；
3. KC26 `PUT /clients` partial body 孤儿化 SA——种子/README 已防；若后续出现
   批量 secret 轮换需求，可加 `--set-secret` 子命令走安全路径（未立项）。
