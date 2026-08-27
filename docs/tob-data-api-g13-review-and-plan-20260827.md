# ToB 数据 API Gate 13：数据服务面 实施计划与验收清单

> 日期：2026-08-27
> 状态：实施中（Gate 式：方案 → 实施 → 远端实测 → gate 报告）
> 前置文档：`docs/technical-architecture.md` §5.8（数据服务）、§6（L4 产品层）
> 阶段定位：核心职责 4「完善 ToB 端 API 接口」；安全加固按备忘延后

---

## 一、Goal

把「数据服务」从架构原则变成可交付的 ToB 能力：外部调用方（医院科研科、
合作药企、监管报送系统）持 API Key，通过独立数据 API 网关查询平台已发布
的数据产品，全程参数化、限额、审计、可追溯到口径与版本。

**架构对齐（technical-architecture.md §5.8 四条红线）：**

1. 定义、参数、合同、责任人、版本归控制面（data-os）；可执行查询只来自
   发布时登记的参数化 SQL 模板（指向 Doris 真实表），**不维护任意 SQL**；
2. 同步查询只允许参数化 `SELECT`，带 statement timeout 与最大行数；
3. 每次调用记录服务、版本、调用方、参数摘要、行数、耗时与状态；
4. 执行面使用独立 Doris 只读账号（`dataos_api_ro`）与独立进程，BFF/门户
   故障不影响 ToB API，反之亦然。

## 二、现状盘点（2026-08-27 实测）

- **占位服务**：远端 `/root/data-api-0.1.0.jar`（data-ops 时代 Spring Boot，
  `Exited 4 weeks ago`，无源码在本仓库）。语义可借鉴：数据集目录、下载、
  质量报告、反馈、医院行级权限（`X-Forwarded-User/Groups` → hospital_code）。
  G13 在本仓库重做，不复活该 jar。
- **数据面**（Doris 172.16.66.8:9030 实查行数）：

  | 表 | 行数 | 用途 |
  |---|---|---|
  | `ods_ep.ep_mz_cfzb` / `ep_mz_ypcfmx` | 11442 / 12215 | 电子处方真实数据（G1-G5 链路产物） |
  | `medical_platform_datasets.ds_research_cohort` | 4 | 科研队列（data-ops 遗留，列含 name 明文 PHI） |
  | `medical_platform_datasets.ds_ops_dashboard` | 52353 | 运营明细（同上） |
  | `medical_platform_marts.dws_patient_360` | 52353 | 患者 360 统计宽表 |
  | `dataos_ai.chunks` | 8 | RAG 语料块 |

- **可复用骨架**：`services/ai-ready-service/`（FastAPI + settings + Doris
  pymysql 适配器 + OIDC/JWKS 认证 + 测试骨架）；control-plane `ai/` 域
  （管理面域模板，迁移下一个编号 V13）；门户 AIDataPage（管理页模板）。
- **OIDC 基建**：S7 已建 client `dataos-ai-ready` + audience mapper 流程，
  data-api 服务间认证复用同模式新建 client `dataos-data-api`。

## 三、架构与决策

```text
门户 ──BFF──> control-plane（管理面：定义/Key/审计/统计，V13 三表）
                    │ 内部端点（OIDC client_credentials，30s 缓存）
                    ▼
              services/data-api（执行面：FastAPI，独立只读账号）
                    │ 参数化 SELECT（pymysql 绑定参数）
                    ▼
              Doris（L4 产品表 + ODS 真实表）
```

| 决策点 | 选择 | 理由 |
|---|---|---|
| 执行面形态 | 独立 Python FastAPI `services/data-api/` | 复用 ai-ready-service 全套骨架最快；FastAPI 自动 OpenAPI 即 ToB 文档；与门户/BFF 进程隔离满足 §5.8 可用性隔离 |
| ToB 认证 | API Key（`X-API-Key`，SHA-256 只存 hash） | ToB 调用方是系统不是人，Key 比 OIDC 授权码流合适；Key 发放/吊销在控制面 |
| 服务间认证 | OIDC client_credentials（Keycloak client `dataos-data-api`） | S7 模式复用，静态 token 是倒退 |
| Key 校验位置 | data-api 回源控制面，本地缓存 30s | 定义与 Key 权威单一在控制面；30s 窗口内吊销延迟，内测期口径记入文档 |
| 配额 | Key 级每日调用数 + 服务级 max_rows + statement timeout | §5.8 红线 2；大结果异步导出延后（备忘 P7） |
| PHI | 模板 SQL 一律不含 `name`/`id_card` 明文列；队列类只出 `id_card_masked` | 汇报与 API 均不出患者标识明文 |
| 行级权限 | `hospital_code` 由 Key 授权集合绑定注入（非调用方自报） | 吸收占位服务语义，但授权归控制面管理 |

## 四、Scope（文件级改动清单）

### 4.1 control-plane（Java 21 / Spring Boot，新域 `dataservice/`）

- `V13__data_service.sql`：`data_service`（定义+版本+状态机+参数 schema+
  列契约 JSON）、`data_service_key`（key_hash+调用方+租户+授权医院/服务+
  日配额+状态）、`data_service_call`（审计）
- `DataService`（实体）、`DataServiceKey`、`DataServiceCall` + Repository
- `DataServiceService`：create/publish/deprecate（状态机 DRAFT→PUBLISHED→
  DEPRECATED，发布时校验模板含参数占位完整性）、newVersion、发 Key（明文
  只回显一次）/吊销、审计记录与查询、统计聚合
- `DataApiController`：`/api/v1/data-services` CRUD + `/{id}/publish` +
  `/{id}/keys` + `/keys/{id}/revoke` + `/{id}/calls` + `/overview`
- `DataApiInternalController`：`/internal/data-api/registry`（发布定义+有效
  Key 投影，OIDC audience `data-api` 校验）——执行面拉取的单一入口
- 配置：`DataApiProperties`（内部端点 audience 白名单）

### 4.2 执行面 `services/data-api/`（Python 3.12 / FastAPI，新建）

```text
services/data-api/
├── app/
│   ├── main.py          # FastAPI 装配 + healthz/readyz
│   ├── api.py           # /v1/services 目录、/v1/services/{code}/query、/schema
│   ├── security.py      # X-API-Key 校验（回源控制面 registry，30s 缓存）
│   ├── controlplane.py  # OIDC client_credentials + registry 拉取客户端
│   ├── executor.py      # 参数校验（类型/必填/枚举/pattern）+ pymysql 参数化
│   │                    # SELECT + max_rows 截断 + read_timeout
│   ├── models.py        # Pydantic（camelCase alias，Java 侧对齐 G9 教训）
│   └── settings.py
├── tests/               # 契约：401/403/参数拒绝/行数截断/模板注入拒绝
├── Dockerfile           # 复用 ai-ready-service 模式
└── pyproject.toml       # fastapi/uvicorn/pymysql/pyjwt/httpx/pytest
```

- 查询语义：模板 SQL 中 `:param` 占位 → 校验后逐个转 pymysql `%s` 绑定；
  拒绝多语句（`;` 出现在模板外的参数值经绑定天然安全，模板本身只存
  单条 SELECT——发布时控制面静态校验：必须以 SELECT 开头、无分号、无
  DML 关键字）。
- 审计：查询完成后 POST 回控制面 `/internal/data-api/calls`（尽力而为，
  失败本地环形缓冲重试，不阻塞响应）。

### 4.3 门户（prototype）

- `pages/DataServicesPage.tsx`：服务目录（状态徽章/负责人/版本/调用量）+
  详情（参数契约表、列契约表、调用示例 curl）+ Key 管理（发放一次性明文
  弹窗、吊销）+ 近期调用审计表
- `data/dataServicesApi.ts`：BFF 客户端（复用 useApiResource 模式）
- 导航：数据消费区新增「数据服务」

### 4.4 部署与数据面

- `deploy/doris/data-api-readonly-account.sql`：`dataos_api_ro`（仅 SELECT
  on `ods_ep.*`、`medical_platform_datasets.ds_research_cohort`、
  `medical_platform_marts.dws_patient_360` + compute group USAGE——G6/G10
  门槛坑）
- `deploy/dev/docker-compose.yml`：`data-api` 段（OIDC issuer 网关 8443 对齐
  S7、DORIS_API_PASSWORD、CONTROL_PLANE_BASE_URL）
- Keycloak：client `dataos-data-api` + audience mapper（S7 流程）
- 门户 nginx：`18085 → data-api:8080`（内测直连口，ToB 调用方经此访问）
- 首批发布 3 个服务定义（种子 SQL，`deploy/scripts/data-api-seed.sql` 或经
  API 灌入）：
  1. `prescription-daily-summary`：ods_ep 处方日汇总聚合（无 PHI 明细），
     参数 `start_date/end_date`
  2. `research-cohort-masked`：科研队列脱敏投影（不出 name），参数
     `hospital_code`(Key 授权交集)/`min_quality_score`/`limit`
  3. `patient-360-stats`：患者 360 按医院聚合统计，参数 `hospital_code`

## 五、API 契约（本 Gate 交付面）

### 管理面（control-plane，OIDC 保护）

```http
GET    /api/v1/data-services                     # 目录（含调用量聚合）
POST   /api/v1/data-services                     # 创建（DRAFT）
GET    /api/v1/data-services/{id}                # 详情（契约+版本+keys 脱敏）
POST   /api/v1/data-services/{id}/publish        # DRAFT→PUBLISHED（模板静态校验）
POST   /api/v1/data-services/{id}/deprecate      # PUBLISHED→DEPRECATED
POST   /api/v1/data-services/{id}/keys           # 发 Key（明文仅此一次）
DELETE /api/v1/data-services/{id}/keys/{keyId}   # 吊销
GET    /api/v1/data-services/{id}/calls          # 审计（分页）
GET    /api/v1/data-services/overview            # 总量/今日调用/活跃 Key
```

### 内部面（OIDC client `dataos-data-api` 专用）

```http
GET  /internal/data-api/registry    # 已发布定义 + 有效 Key 投影（hash+授权）
POST /internal/data-api/calls       # 执行面审计回写（Idempotency-Key 幂等）
```

### ToB 面（data-api，X-API-Key）

```http
GET  /healthz
GET  /v1/services                              # 调用方可见目录（按 Key 授权过滤）
GET  /v1/services/{code}/schema                # 参数与列契约
POST /v1/services/{code}/query                 # { "parameters": {...} }
     → { "service", "version", "columns", "rows", "rowCount",
         "truncated", "elapsedMs", "dataFreshness" }
```

错误契约：401 `API_KEY_INVALID` / 403 `SERVICE_NOT_AUTHORIZED` /
429 `QUOTA_EXCEEDED` / 400 `PARAM_INVALID`（带字段级原因）/ 503 `DORIS_UNAVAILABLE`。

## 六、Phases

1. **P1 管理面域**：V13 迁移 + 实体/服务/控制器 + 单测（状态机、模板静态
   校验、Key hash、配额计数）
2. **P2 执行面服务**：data-api 骨架 + 安全回源 + 执行器 + 契约测试
   （`pytest`，全绿门槛）
3. **P3 门户**：管理页 + API 客户端 + `tsc/vitest/qa/build` 全绿
4. **P4 远端交付**：Doris 账号、Keycloak client、compose 段、镜像构建推送、
   种子定义灌入、ToB 端到端实测（curl 模拟外部调用方）
5. **P5 收尾**：gate 报告、备忘更新、提交推送、记忆

## 七、验收清单（Gate）

| # | 项 | 证据 |
|---|---|---|
| 1 | 管理面全绿：V13 迁移真 PG 通过，状态机/模板校验/Key 单测通过 | `mvn test` |
| 2 | 执行面全绿：认证/授权/参数拒绝/注入拒绝/截断/超时契约测试 | `.venv pytest` |
| 3 | 门户全绿：tsc + vitest + mock-audit + interactions + build | 前端命令链 |
| 4 | Doris 只读账号：`dataos_api_ro` 查询成功、越权库被拒、compute group 通过 | mysql 实测 |
| 5 | ToB 闭环：发 Key → `POST /v1/services/prescription-daily-summary/query` 返回真实处方汇总行 | curl 实测（只对账行数） |
| 6 | PHI 守卫：`research-cohort-masked` 响应无 name/id_card 明文字段 | 响应字段断言 |
| 7 | 配额与限额：max_rows 截断 `truncated:true`；错误 Key 401；未授权服务 403 | curl 实测 |
| 8 | 审计闭环：控制面 `/calls` 可见每次调用（服务/Key/行数/耗时/状态） | 管理端点查询 |
| 9 | 隔离性：重启门户/control-plane 不中断 data-api 在途查询（进程隔离证据） | 实测 |

## 八、边界与回滚

- 边界：不做异步导出、不做订阅推送、不做计费账单、不做 API 网关级
  全局限流（单 Key 配额足够内测）；DB-GPT 问数不走本 Gate。
- 回滚：V13 三表独立 DROP；data-api 容器停用删除；门户页面与导航 revert；
  Doris 账号 DROP；Keycloak client 删除。均不影响既有链路。

## 九、延后清单（G13 后）

- 大结果集异步导出至对象存储 + 下载 URL（§5.8 完整形态）→ 备忘 P7
- API 网关级限流/熔断/按调用方 SLA（内测期单 Key 配额替代）
- 审计回写失败环形缓冲的持久化落盘（当前内存重试）
- ToB 调用方门户自助门户（当前控制面代发 Key）
- 数据合同变更 diff 告警通知订阅方
