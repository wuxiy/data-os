# G8 验收报告：AI Ready 域基础 — 2026-08-27

对照方案 `docs/ai-ready-g8-review-and-plan-20260826.md`。结论：**8/8 通过**。
AI Data Product 三件套（Manifest / Version / Lifecycle）在 control-plane 与门户
落地；build 守护语义（引擎未装配 → 503 + `AI_READY_ENGINE_NOT_CONFIGURED`，
门户显示「评估引擎待接入」而非伪造成功）全链验证。P1–P4 四阶段完整执行。

## 一、验收表

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 迁移 | ✅ | `V10__ai_data_product.sql`（840d6c2）；本批全量测试经 H2 空库 Flyway 全链（V1→V10）通过；V9 既有数据零影响（全量回归绿） |
| A2 | 状态机 | ✅ | `AIDataProductLifecycleTest` 期望矩阵锁定全量 (from,to) 组合 7/7；HTTP 面 DRAFT→CURATED 200、CURATED→SERVING 409（安全测试 + 远端实测） |
| A3 | 版本唯一性 | ✅ | 创建即登记 v0.1.0（buildStatus=REGISTERED，版本历史从创建起可追溯）；`(product_id, version_sn)` 约束以 `DuplicateKeyException` 用例锁定 |
| A4 | 安全 | ✅ | ENFORCED 契约测试：未登录 401、viewer 写 403、跨租户产品 404（不泄漏存在性）；安全规则：GET 全角色、写 platform-admin/tenant-admin/data-engineer（与 sources/jobs 写口径一致）；审计由 AuditInterceptor 覆盖 `/api/**` |
| A5 | build 守护 | ✅ | Service 单测 `EngineNotConfiguredException`；HTTP 503 + code `AI_READY_ENGINE_NOT_CONFIGURED`（远端实测）；门户常驻「评估引擎待接入（G9）」说明区 |
| A6 | 前端质量 | ✅ | tsc / vitest 14/14（新增 aiDataApi 契约：列表/创建/409/503 code） / mock-audit / portal-interactions-smoke / build 全绿；demo 模式零改动（无 AI mock，演示构建显示显式边界说明） |
| A7 | 门户口径 | ✅ | 浏览器实测 `/ai-data`：产品列表（名称/类型/版本/生命周期）、创建表单（8 类产品类型）、版本历史表、生命周期推进/弃用操作；截图 `ai-ready-g8-portal-detail-20260827.png`、`ai-ready-g8-portal-create-20260827.png` |
| A8 | 回归 | ✅ | control-plane `mvn test` 全量零失败（含 G0-G7 既有测试零修改）；导航/路由新增不影响既有页面 |

## 二、实施记录（P1–P4）

| 阶段 | 内容 | 提交 |
| --- | --- | --- |
| P1 | V10 迁移 + 域模型（Type/Lifecycle/record）+ 状态机契约测试 | 840d6c2（8/26 会话） |
| P2 | Repository/Service/Controller + 503 守护 + 安全规则 + Service/Security 测试 | 0fd6633 |
| P3 | 门户 routes/aiDataApi/AIDataPage/AIDataDetailPage + 导航 + vitest | 7bd269f |
| P4 | 远端部署（`0.1.0-ai-ready-g8-20260827`）+ API/浏览器验证 + 本报告 | 本提交 |

## 三、与方案的偏差（如实记录）

1. **先修复了 main 的编译坏点**（d5f5e16）：8/26 会话的 f2b5948（补 G7 漏提交）
   在 2744e16 已含 `ColumnMapping` record 的文件上叠加了第二份定义，此后 main
   分支不可编译。本批以「删重复份」最小修复开场，全量测试验证后先行提交。
2. **写操作角色集**（方案未指定）：取 platform-admin/tenant-admin/data-engineer，
   与 sources/jobs 写口径一致；GET 与治理读面一致（全角色含 viewer）。
3. **详情页渲染形态**：方案列了两个页面组件（均已交付），但路由只有
   `/ai-data` 一个——详情在列表页右侧工作区内选中渲染（与资产目录页同模式），
   未加独立子路由。

## 四、部署面留档

- 镜像 `medical-platform/data-os-control-plane:0.1.0-ai-ready-g8-20260827`
  （构建目录 `/root/ai-g8-build/control-plane`）；`.env` 已切换；portal-dist 已更新。
- 验证用产品 1 条（「临床指南 RAG 语料库」，DRAFT→CURATED）留存演示；
  回滚 = 镜像/portal-dist 回退 + `ai_data_product*` 三表独立可 DROP（不触既有表）。

## 五、延后清单（进入 G9）

- 评估引擎（ai-ready-service：Requirement/Profile/6C 评分/Certification Gate）
- 真实 build 执行与 readiness 回写；OpenMetadata 回写（G11）
- AI Data Dashboard 指标（G12）
