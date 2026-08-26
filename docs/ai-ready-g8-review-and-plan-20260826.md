# AI Ready Gate 8：域基础 实施计划与验收清单

> 日期：2026-08-26
> 状态：实施计划（待评审）
> 前置：`docs/architecture/ai-ready-data.md`（架构 v1.0）、`docs/ai-ready-iteration-plan-20260826.md`（G8–G12 总计划）
> 技术栈决策：**ai-ready-service 采用 Python**（与 quality-runner 同栈）——2026-08-26 用户确认；控制面/门户侧的 AI Data Product 域（本 Gate）仍落在 Java control-plane

---

## 一、Goal

把 AI Data Product 作为一等域对象落地到 control-plane 与门户：**Manifest / Version / Lifecycle 三件套**，打通「创建 → 构建登记 → 状态机流转 → 列表/详情展示」，但不实现真实评估引擎（G9）、不引入 AI 加工链（G10）。

本 Gate 的验收口径遵循项目既有惯例：**真实 API + 契约测试 + 前端全绿 + 不把演示状态当真实业务事实**。

---

## 二、Scope（文件级改动清单）

### 2.1 control-plane（Java 21 / Spring Boot）

| 文件 | 内容 |
|---|---|
| `src/main/resources/db/migration/V10__ai_data_product.sql` | 迁移：`ai_data_product`、`ai_data_product_version`、`ai_recipe_registry` 三表（DDL 草案见 §四） |
| `src/main/java/com/cywu/dataos/controlplane/ai/AIDataProductType.java` | enum：`RAG_CORPUS / TRAINING_DATASET / INSTRUCTION_DATASET / PREFERENCE_DATASET / FEATURE_DATASET / AGENT_CONTEXT / EVALUATION_DATASET / MULTIMODAL_DATASET` |
| `.../ai/AIDataProductLifecycle.java` | enum + 状态机：`DRAFT → CURATED → ASSESSED → CERTIFIED → SERVING`，`DEPRECATED` 从任意终态可入；非法流转抛域异常 |
| `.../ai/AIDataProduct.java` | 域模型 record（id/name/type/owner/workflow/source/currentVersion/lifecycle/createdAt/updatedAt） |
| `.../ai/AIDataProductVersion.java` | 版本 record（productId/versionSn/recipeRef/gitCommit/snapshotAt/readinessScoreJson/buildStatus/createdAt） |
| `.../ai/AIDataProductRepository.java` | JdbcTemplate 仓储（仿 `source/SourceRepository`）：创建、按 id 查、列表（租户过滤）、版本插入/历史查询 |
| `.../ai/AIDataProductService.java` | 域服务：创建（semver 起始 v0.1.0）、生命周期流转（调状态机）、`build` 登记（引擎未装配 → 明确错误） |
| `.../ai/AIDataProductController.java` | 控制器（仿 `workflow/ClinicalWorkflowController`）：见 §三 API |
| `src/test/java/com/cywu/dataos/controlplane/ai/AIDataProductLifecycleTest.java` | 状态机契约测试：合法/非法流转全覆盖 |
| `src/test/java/com/cywu/dataos/controlplane/ai/AIDataProductServiceTest.java` | 服务测试：创建、版本唯一性、build 未装配错误、租户隔离 |
| `src/test/java/com/cywu/dataos/controlplane/security/AIDataProductSecurityTest.java` | 401/403 契约测试（未登录/跨租户） |

### 2.2 门户（prototype，React 19 + Vite）

| 文件 | 内容 |
|---|---|
| `src/data/routes.ts` | 增加 `aiData: '/ai-data'` |
| `src/data/aiDataApi.ts` | API client（list / detail / create / lifecycle / build），真实 HTTP + 类型定义 |
| `src/pages/AIDataPage.tsx` | AI Data 产品列表页（Name/Type/Owner/Lifecycle/CurrentVersion/Score 占位） |
| `src/pages/AIDataDetailPage.tsx` | 产品详情页（版本历史 + 生命周期流转操作 + build 按钮） |
| `src/pages/Pages.module.css`（或新 module） | 页面样式（复用既有 design tokens） |
| `src/App.tsx` | 注册 `/ai-data` 路由 + 侧边导航入口「AI Data」 |
| `src/data/aiDataApi.test.ts` | vitest：api client（mock fetch）、列表/详情渲染 |

### 2.3 文档

| 文件 | 内容 |
|---|---|
| `CONTEXT.md` | ✅ 已完成（AI Ready Data 术语段落） |
| `tasks/todo.md` | G8 勾选状态在 Gate 验收后更新 |
| 本文件 | G8 验收证据归档（验收后更新图片/结果） |

---

## 三、API 契约（本 Gate 交付面）

| 方法 | 路径 | 请求 | 响应/行为 |
|---|---|---|---|
| POST | `/api/v1/ai-data-products` | `{name, type, owner, workflow, source}` | 201 + 产品（lifecycle=DRAFT，currentVersion=v0.1.0） |
| GET | `/api/v1/ai-data-products` | 分页/租户默认 | 200 列表 |
| GET | `/api/v1/ai-data-products/{id}` | — | 200 详情（含版本历史） |
| POST | `/api/v1/ai-data-products/{id}/lifecycle` | `{target: "CURATED"}` | 200 新状态；非法流转 409 |
| POST | `/api/v1/ai-data-products/{id}/build` | `{recipeRef?}` | **引擎未装配 → 503 + 明确错误码 `AI_READY_ENGINE_NOT_CONFIGURED`**（守护"不伪造真实能力"原则） |

鉴权/租户：与 G0 一致——OIDC 保护 `/api/**`，租户参数不能越权，写操作审计入库。

---

## 四、迁移 DDL 草案

```sql
-- V10__ai_data_product.sql （主键/时间戳风格对齐 V1 基线：VARCHAR(36) UUID 主键、TIMESTAMP、data_os schema）
CREATE TABLE IF NOT EXISTS data_os.ai_data_product (
    id              VARCHAR(36)  PRIMARY KEY,
    tenant_id       VARCHAR(128) NOT NULL,
    name            VARCHAR(128) NOT NULL,
    product_type    VARCHAR(32)  NOT NULL,
    owner           VARCHAR(64)  NOT NULL,
    workflow_type   VARCHAR(32)  NOT NULL,
    source_desc     TEXT         NOT NULL,
    current_version VARCHAR(32)  NOT NULL,
    lifecycle       VARCHAR(16)  NOT NULL,
    created_at      TIMESTAMP    NOT NULL,
    updated_at      TIMESTAMP    NOT NULL,
    CONSTRAINT uq_ai_data_product_name UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS data_os.ai_data_product_version (
    id             VARCHAR(36) PRIMARY KEY,
    product_id     VARCHAR(36) NOT NULL,
    version_sn     VARCHAR(32) NOT NULL,
    recipe_ref     VARCHAR(96),
    git_commit     VARCHAR(64),
    snapshot_at    DATE,
    readiness_json TEXT,
    build_status   VARCHAR(16) NOT NULL,
    created_at     TIMESTAMP   NOT NULL,
    CONSTRAINT uq_ai_data_product_version UNIQUE (product_id, version_sn),
    CONSTRAINT fk_ai_data_product_version_product FOREIGN KEY (product_id) REFERENCES data_os.ai_data_product(id)
);

CREATE TABLE IF NOT EXISTS data_os.ai_recipe_registry (
    id            VARCHAR(36) PRIMARY KEY,
    name          VARCHAR(96) NOT NULL,
    version       VARCHAR(32) NOT NULL,
    git_ref       VARCHAR(64) NOT NULL,
    registered_at TIMESTAMP   NOT NULL,
    CONSTRAINT uq_ai_recipe_registry UNIQUE (name, version)
);
```

> 注：对齐 V1 基线风格——`data_os.` schema、`VARCHAR(36)` UUID 主键、`VARCHAR(128)` tenant_id、`TIMESTAMP` 时间戳、显式 UNIQUE/FK 约束名；迁移按 Flyway V10 递增，不触碰既有 V1–V9。

---

## 五、Phases

| # | 内容 | 验证 |
|---|---|---|
| P1 | 迁移 + 域模型 + 状态机 + 单测 | `JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn test` 相关类全绿 |
| P2 | Repository / Service / Controller + 安全契约测试 | `mvn test` 全量回归（新增除外零修改） |
| P3 | 前端 routes/api/页面/导航 + vitest | `cd prototype && npx tsc -b && npx vitest run && node qa/mock-audit.mjs && node qa/portal-interactions-smoke.mjs && npm run build` |
| P4 | 远程部署（如开发机可达）+ 浏览器验证截图 + 文档收口 + 提交 | 截图归档；git 提交 |

---

## 六、验收清单（Gate）

| # | 项目 | 通过标准 |
|---|---|---|
| A1 | 迁移 | 空库初始化 + 升级路径通过；`ai_` 表结构与 DDL 一致；V9 既有数据零影响 |
| A2 | 状态机 | 契约测试全覆盖：DRAFT→CURATED→ASSESSED→CERTIFIED→SERVING 合法；SERVING 回退/跳过流转被拒（409） |
| A3 | 版本唯一性 | 同产品重复版本插入被拒；版本历史按时间序可查 |
| A4 | 安全 | 未登录 401；非授权 403；跨租户访问隔离 |
| A5 | build 守护 | 引擎未装配时 `POST /build` 返回 503 + 明确错误码，门户显示"评估引擎待接入"空态而非伪造成功 |
| A6 | 前端质量 | tsc / vitest / qa mock-audit / portal-interactions-smoke / build 全绿；demo 模式零改动 |
| A7 | 门户口径 | AI Data 列表/详情渲染真实 API；未接入能力明确不可用 |
| A8 | 回归 | 既有 control-plane mvn 全量、前端全量测试零失败（新增文件除外） |

---

## 七、边界与回滚

- **不做**：评估算法（G9）、AI 加工链（G10）、OpenMetadata 回写（G11）、Label Studio（延后）。
- 回滚：移除 V10 迁移 + `ai` 包 + 前端页面 revert；既有功能零触碰。
- 门户 build 按钮在引擎未装配时禁用并展示原因——不能把"登记请求"冒充"构建成功"。

---

## 八、延后清单

- Recipe 真实执行器（G10）
- 6C 评估 / Profile / Requirement（G9）
- 评估结果回写 OpenMetadata（G11）
- AI Data Dashboard 指标（G12）

---

## 九、审核结论（2026-08-26）

| # | 审核点 | 结论 |
|---|---|---|
| 1 | G8 文件清单 + API 契约（build 返回 503 守护语义） | ✅ 确认 |
| 2 | 三表 DDL 命名/字段（已对齐 V1 基线风格） | ✅ 确认 |
| 3 | 前端导航名「AI Data」 | ✅ 确认 |
| 4 | P4 上开发机部署验证 + 截图归档 | ✅ 确认执行 |

> **执行条件已满足：审核点 1–4 全部 ✅，P1 可开工。**
---

## 十、验收结论（2026-08-27）

G8 验收 **8/8 通过**，证据见 `docs/validation/gate-ai-ready-g8-20260827.md`。
P2-P4 实施与本方案的三处偏差（f2b5948 编译坏点先行修复、写角色集、详情同路由渲染）
已在验收报告 §三如实记录。G9（Engine MVP）按总计划继续。
