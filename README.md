# data-os（医数中枢）

医疗数据采集、治理、运营的统一门户。底层以 SeaTunnel、Doris、OpenMetadata、HAPI FHIR 等开源组件作为可替换执行器，甲方用户只面对统一的中文业务门户，不接触组件原生控制台。

## 文档地图

- `docs/medical-data-platform-blueprint.md`：平台架构蓝图（已批准）——组件选型、数据分层、门户页面、部署档位、交付路线与安全合规。
- `docs/technical-architecture.md`：技术架构实施基线——控制面模块、组件适配契约、数据与边缘架构、部署、降级和回滚。
- `docs/implementation-plan.md`：20 周 MVP 实施计划——工作包、团队、里程碑、验收门槛、依赖和风险。
- `DESIGN.md`：第一版原型的视觉设计系统（色彩、字体、组件规则）。
- `prototype/`：React + Vite 高保真桌面原型，路由与数据说明见其 `README.md`。
- `services/control-plane/`：Java 21 / Spring Boot 控制面首条垂直切片，含数据源、采集任务、运行记录和治理摘要 API。
- `deploy/dev/`：不含密钥的开发环境 Compose 覆盖；复用 data-ops 的 PostgreSQL 与 `platform-net`。
- `tasks/`：执行计划与结果复盘（`todo.md`）、经验教训（`lessons.md`）。

## 当前状态

- 架构蓝图已定稿并通过评审；技术架构和 20 周 MVP 实施计划已形成实施基线，外部依赖与兼容性决策门需在 W1—W2 完成。
- 前端已完成 10 个桌面路由页面：新增“数据接入”工作台，并保留治理、资产、分析、问数和主索引等业务工作台；所有页面使用统一门户，不暴露组件原生菜单。
- 控制面首条垂直切片已实现：`GET/POST /api/v1/sources`、`GET/POST /api/v1/jobs`、`POST/GET /api/v1/jobs/{id}/runs`、`GET /api/v1/governance/summary` 与 `/actuator/health/readiness`。
- 已部署到开发机 `172.16.65.59` 的独立 `/root/data-os-dev-20260803` 目录：门户 `18081`、控制面容器和 `data_os` schema 已通过 API 验收；SeaTunnel 保留为可选 profile，当前因开发机访问 Docker Hub 超时未启动。

## 运行原型

```bash
cd prototype
npm install
npm run dev
```

生产构建与路由回退要求见 `prototype/README.md`。
