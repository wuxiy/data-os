# Gate · G2G 批次 7：Keycloak 统一认证收口（系列收官）

- 日期：2026-10-05
- 依据：[g2g-batch7-auth-unification-plan-20261005.md](../g2g-batch7-auth-unification-plan-20261005.md)；覆盖矩阵缺口 #6、裁决 ④（S 批次做在 data-os 侧，nema 侧不投）
- 结果：**通过**（dev 真实 Keycloak 上种子幂等二跑 + 冒烟五链全绿；纯 deploy/docs 交付，代码基线不动）

## 交付范围

### 映射裁决落地

- **nema 侧零投入**：不搬 upms 权限 UI（Keycloak 替代）、不做 nema 子系统接入；本批 = data-os 侧自身收口。
- **收口三件**：服务间种子面（此前散落各批手工）、认证矩阵（可运维一览）、dev 实测冒烟（OIDC 服务间链 token 侧首次端到端验证）。
- **种子幂等且不重造**：在位 client 只补缺件（scope/mapper/service account），不换 secret（.env 唯一属主）；新建 client secret 缺省生成仅回显一次。
- **dev 不切 ENFORCED**（运行策略变更须用户裁决）；冒烟以 JWKS 公钥完整复刻被调方验签与 claims 检查证明 token 侧正确。

### 组件

- **`deploy/scripts/keycloak-service-seed.sh`**：realm client scopes（quality:submit/read/admin）+ 服务 client 五个（控制面→runner 全新装配含 audience/tenant/institution mappers；ai-ready/assistant 补 audience mapper；data-api/om-ingest 只确保 service account）。audience mapper 配置对齐 portal seed 已验证形态（含 access.token.claim）。
- **`deploy/scripts/auth-smoke.sh`**：逐 client client_credentials → JWKS 取钥 → 断言 iss（EXPECTED_ISSUER 显式）/aud/scope/租户 claims；quality 链必含 **quality:admin**；出站 client 验可取 token。凭据全部从 env/.env 注入不回显。
- **`docs/deploy-auth-matrix.md`**：门户用户链 + 六条服务间链（client×scope×audience×env 键×被调方校验要点）+ JWKS 直连口径 + 种子/冒烟用法 + 当前模式状态 + 边界三条。
- dev README「Keycloak 服务间认证种子与冒烟」一节 + environment-access-reference §11 互链。

## 测试证据（dev 真实环境）

- **种子**：首跑建 scopes+quality client+全部 mapper；二跑 22 项「在位」零重建（幂等达成）。
- **冒烟五链全绿**（dev Keycloak 172.16.65.59，内网直连 + EXPECTED_ISSUER 按网关值）：
  - `PASS quality 链`：aud=dataos-quality-runner + scope 含 submit/read/**admin** + tenant_id/institution_id——**批次 2 的 quality:admin 欠账就此关闭**（token 侧实证）；
  - `PASS ai_ready 链`（aud=dataos-ai-ready）、`PASS assistant 链`（aud=dataos-data-api）；
  - `PASS data_api / om_ingest 出站`（可取 token、iss 正确）。
- 仓库内：两脚本 `bash -n` + 内嵌 python `ast.parse` 通过。
- 代码零变更（纯 deploy/docs），全仓测试基线不动。

## 实抓问题与修复（dev 实测过程）

1. Keycloak Admin URL 漏 `/auth` 前缀（KC26 `--http-relative-path=/auth`）→ 404；admin 登录端点先探测再用。
2. `/client-scopes/{name}` 端点不存在（按 UUID 查）→ 改列表匹配。
3. **audience mapper 缺 `access.token.claim: "true"` 不生效**（aud 恒为 account）——对照 portal seed 已验证配置修正；dev 上清坏 mapper 重挂后通过（ai_ready 之所以先前能过，是其 client 早有手工配好的同名目标 mapper）。
4. 内网直连取 token 时 iss 仍按网关 hostname 签发（--hostname 前端化）→ 冒烟支持 EXPECTED_ISSUER 断言（与 S7「iss 按网关值校验」口径一致）。
5. 跨轮操作的 secret 不一致（首跑临时值 vs .env 追加值）→ 按「.env 唯一属主」原则归一（整 client PUT 带 secret），并把操作流程写进 README 防复发。

## 边界（记 backlog）

1. dev 切 ENFORCED 的整链验证（门户登录 + 服务间同开）——运行策略变更，用户裁决。
2. 控制面→MPI 投影无 OIDC client 消费代码（dev DISABLED 直连）；MPI ENFORCED 前须补调用侧凭据，本批不预造无消费者的 client。
3. 生产 realm 尚未跑服务间种子（脚本 dev/prod 通用，生产上线按矩阵 §四操作）。

## G2G 系列收官

批次 1-7 全部交付：采集操作深水区（两刀）→ 质量规则动态化 + 16 类规则（两刀）→ 评分模型 → 前置机运维域（两刀）→ ETL 调度中文化（两刀）→ MPI 实战参数基线 → Keycloak 统一认证收口。覆盖矩阵 §G2G 七批次闭环；跨批累积的 dev 真实链路核验欠账（批次 2-5 各一条）集中记 backlog 待用户裁决排期。
