# G2G 批次 7 · Keycloak 统一认证收口（规划，2026-10-05）

> 依据：覆盖矩阵 §G2G 批次 7「Keycloak 统一认证（data-os 侧，门户 + 各服务 OIDC client）」；裁决 ④「S 批次做在 data-os 侧，nema 侧不投」；缺口 #6。

## 勘察结论（现状盘点）

### 已交付（H2/H3 及各批遗产）

- **门户用户链**：PKCE 登录 + 生产种子 `keycloak-portal-seed.sh`（7 个 realm 角色 + portal client + audience/租户 claim mapper + 演示用户）；dev 实证过全流程。
- **服务侧验签**：control-plane / mpi-service OIDC ENFORCED 默认 + JWKS 内网直连；quality-runner ENFORCED 默认（scope claim + **tenant_id/institution_id claims 强制**）；ai-ready OIDC 优先（静态令牌兜底）；data-api 资源 JWT（internal 路由 fail-closed）。
- **调用侧实现**：OidcClientCredentialsTokenProvider（控制面→runner/ai-ready/data-api）；DS token 轮转器；OM jwtToken（S7）。

### 缺口（=本批收口对象）

1. **服务间种子面缺失**：生产种子只覆盖门户用户链；五个服务 client（控制面→runner、控制面→ai-ready、控制面→data-api 问数、ai-ready→OM、data-api 出站）散落各批手工建——dev realm 里部分存在、配套件（scope/audience/tenant mapper）不全；**批次 2 遗留的 quality:admin scope 欠账至今**（dev 因 auth=DISABLED 未暴露）。
2. **无认证矩阵**：哪条链路用哪个 client/scope/audience/env 键，只散在 compose 注释与各 gate 文档里——「统一认证」缺可运维的一览交付物。
3. **dev 从未端到端验证 OIDC 服务间链**（全部 DISABLED）：token 侧正确性（aud/scope/tenant claims + RS256）无冒烟手段。

### 现场事实（2026-10-05 dev 实查）

- dev 全链 auth=DISABLED（control-plane/runner/mpi 均 DISABLED，.env 未设 DATAOS_AUTH_MODE）；Keycloak 共享容器 `medical-platform-keycloak-1`（kcadm 在位）；远程 .env 持有 ai-ready/assistant/data-api/om-ingest 四个 client 的 secret；**控制面→runner 的 quality client 从未建**（CLIENT_ID 空）。

## 映射裁决

1. **nema 侧零投入**（裁决 ④）：不搬 upms 权限 UI（Keycloak 替代）、不做 nema 子系统接入。本批= data-os 侧自身收口。
2. **种子幂等且不重造**：已存在的 client（四个有 secret 的）只**补缺件**（client scopes / audience mapper / tenant-institution claim mapper），不重建不换 secret——.env 是 secret 唯一属主。
3. **新建 client 的 secret 流**：env 给定则用之（操作员预生成写 .env），否则生成并仅创建时回显一次（沿用 portal seed 惯例）。
4. **dev 不切 ENFORCED**：本刀以**冒烟完整复刻 runner.verify 的验签与 claims 检查**（JWKS 公钥验签 + aud/scope/tenant 断言）证明 token 侧正确；把 dev 服务切 ENFORCED 属运行策略变更（可能影响现有演示链），记 backlog 由用户裁决。
5. **矩阵文档是交付物**：认证矩阵（链路×方向×client×scope×audience×env 键×当前模式）落 `docs/deploy-auth-matrix.md`，与 environment-access-reference 互链。

## 实施（单刀：种子 + 矩阵 + 冒烟 + dev 实测）

1. **`deploy/scripts/keycloak-service-seed.sh`**（bash + 内嵌 python 调 Keycloak Admin REST，dev/prod 通用）：
   - realm client scopes：`quality:submit` / `quality:read` / `quality:admin`；
   - 服务 client 五个（env 驱动命名，默认 `dataos-control-plane-quality` / `dataos-ai-ready` / `dataos-assistant-bff` / `dataos-data-api` / `dataos-om-ingest`）：confidential + service account；按用途挂 scopes 与 audience mapper（dataos-quality-runner / dataos-ai-ready / dataos-data-api / OM）+ `tenant_id`/`institution_id` 硬编码 claim mapper（env 可调，默认 default/demo-hospital）；
   - 幂等：client 在位→只补缺失 scopes/mappers；scope 在位→跳过；输出补件清单。
2. **`docs/deploy-auth-matrix.md`**：矩阵 + 种子/冒烟用法 + 各服务 env 键 + DISABLED/ENFORCED 语义（dev DISABLED 下 /internal 独立强制等既有口径）。
3. **`deploy/scripts/auth-smoke.sh`**：逐 client 取 client_credentials token → JWKS 验签（RS256/aud）→ 断言 scope（quality client 须含 quality:admin）与 tenant claims → PASS/FAIL 清单，exit code 汇总。
4. **dev 实测**：ssh 开发机跑种子（新 quality client 预生成 secret 写 .env）→ 冒烟全绿 → 批次 2 quality:admin 欠账宣告关闭。
5. dev README / environment-access-reference 补「服务间种子与冒烟」一节。

## 验收

- 种子/冒烟在 dev 实跑通过（幂等二跑输出「在位」不重造）；冒烟含 quality:admin 断言。
- 仓库内脚本 `bash -n` 与 python 语法自检；无代码面变更（纯 deploy/docs），既有测试基线不动。

## 交付注记（2026-10-05，单刀收官）

种子/矩阵/冒烟三件已交付并在 dev 真实 Keycloak 实测（幂等二跑 + 五链冒烟全绿含 quality:admin，批次 2 欠账关闭）；gate-g2g-b7-auth-unification-20261005.md。实施中修正四处脚本问题（Admin URL /auth 前缀、client-scopes 查询、audience mapper access.token.claim、EXPECTED_ISSUER），均已在脚本内固化。G2G 批次 1-7 全部收官。
