# Mock 能力核查与可落地边界

更新时间：2026-11-25

## 结论

当前项目已经把“演示数据”和“真实控制面数据”分成两种明确运行模式：

- 生产构建默认是真实模式。页面数据一律来自控制面/mpi-service API；不可用时显示真实空态，不渲染静态样例。已落地真实链路的页面：数据接入、治理驾驶舱、质量闭环、数据标准、标准映射、主索引、数据资产、分析看板、AI Data、数据服务和智能问数。
- `VITE_DATAOS_DEMO_MODE=true` 只切换运行状态横幅的“演示运行模式”标记。静态演示数据文件（`src/data/integrations.ts`、`src/data/mock.ts`）已随 FE7 退役（7f21fd6），本机演示用 `qa/mock-control-plane.mjs` 合成契约替身供数。
- 治理驾驶舱和数据质量闭环以控制面 API 为准。控制面不可用时不再使用本地问题 mock 兜底。
- 控制面新增 `GET /api/v1/system/status`，只返回运行模式、执行器配置状态和非敏感告警，不返回 URL、密码或令牌。

## 页面边界

| 页面 | 当前数据来源 | 默认真实模式行为 | 演示模式行为 |
|---|---|---|---|
| 数据接入 | 控制面 `/api/v1/sources`、`/api/v1/jobs` | 可用，控制面不可用显示空态 | 同样走真实 API，不伪造运行状态 |
| 治理驾驶舱 | 控制面 `/api/v1/governance/summary` | 可用；失败不展示指标/问题 mock | 同样走控制面，种子数据需由后端显式开启 |
| 质量闭环 | 控制面治理问题、质量批次、通知 API | 可用，状态和证据来自 PostgreSQL | 同样走控制面 |
| 数据标准 | 控制面 `/api/v1/data-standards`（G22） | 可用；失败显示不可用空态 | 同样走控制面 |
| 标准映射 | 控制面 `/api/v1/standard-mappings`（G23） | 可用；失败显示不可用空态 | 同样走控制面 |
| 主索引审核 | mpi-service（门户 `/api/v1/mpi/` 直路由） | 可用，候选、复核与合并/拆分走真实服务 | 同样走 mpi-service |
| 数据资产/技术视图 | 控制面资产/血缘 BFF（`/api/v1/assets/**`、`/api/v1/lineage/**`） | 可用；未配置 OpenMetadata 时显示待接入，不渲染样例 | 同样走控制面 BFF |
| 分析看板 | 控制面分析 BFF + Superset 嵌入（`18084` 专用监听） | 可用；未配置 Superset 时显示待接入，不渲染样例 | 同样走控制面分析 BFF |
| AI Data | 控制面 `/api/v1/ai-data-products` | 可用，不收录静态样例 | 同样走控制面（无 mock 数据） |
| 数据服务 | 控制面 `/api/v1/data-services` | 可用，不收录静态样例 | 同样走控制面（无 mock 数据） |
| 智能问数 | 控制面 `/api/v1/assistant/**`（问题、查询、反馈与治理审计） | 可用；失败显示不可用空态 | 同样走控制面 |

资产、分析和 MPI 已分别经控制面 BFF 与 mpi-service 接入真实服务；数据标准（G22）、标准映射（G23）与智能问数也已接入控制面对应域。页面交互模型保持稳定，静态演示数据已随 FE7 退役，不再有“原型数据页面”。

## 开发与部署

### 交互原型

```bash
cd prototype
node qa/mock-control-plane.mjs --port 18090 &   # 后台合成契约替身
VITE_DATAOS_API_BASE_URL=http://127.0.0.1:18090/api VITE_DATAOS_DEMO_MODE=true npm run dev
npm run qa:mock
```

不设置 `VITE_DATAOS_DEMO_MODE` 即为真实模式构建：

```bash
cd prototype
npm run build
npm run preview
```

### 控制面

`DEMO` 质量规则执行器现在必须同时满足：

```dotenv
DATAOS_QUALITY_EXECUTOR=DEMO
DATAOS_QUALITY_DEMO_ENABLED=true
```

生产环境推荐（控制面运行环境默认按生产处理，开发 Compose 会显式覆盖为 development）：

```dotenv
DATAOS_RUNTIME_ENV=production
DATAOS_SEED_DEMO=false
DATAOS_QUALITY_EXECUTOR=HTTP   # 或 DBT，共用 HTTP 执行契约
DATAOS_QUALITY_EXECUTOR_BASE_URL=http://quality-runner:8080
DATAOS_QUALITY_DEMO_ENABLED=false
```

当 `DATAOS_RUNTIME_ENV=production` 时，控制面会在启动阶段拒绝演示种子数据或 DEMO 质量执行器；HTTP/DBT 未配置地址或通知 Webhook 为空时，运行状态接口会返回告警，不会把未配置显示为已执行或已送达。

```bash
curl -fsS http://127.0.0.1:18081/api/v1/system/status
```

## 验收

- `npm run qa:mock`：确认既有路由均注册、迁移页读真实 API、治理 fallback 已移除、运行模式开关由 runtimeMode 单一持有。
- `npm run build`：验证真实模式生产构建。
- `mvn -q -Dmaven.repo.local=/private/tmp/dataos-m2 test`：验证控制面契约、质量执行器和运行状态接口。
- 浏览器验证真实模式页面不会出现样例问题；演示模式页面显示“演示模式”标记。

## 仍需真实依赖才能进入正式验收的能力

1. 院内真实数据库/接口样本与只读账号。
2. dbt/质量规则执行器的真实 HTTP 服务地址和结果契约。
3. DB-GPT 问数编排的生产服务账号（门户问数域 API 与 BFF 已接入；OpenMetadata、Superset 与 MPI 已接入）。
4. 责任人 Webhook 或院内消息通道。

这些依赖未就绪前，建议将当前版本定位为“数据接入、治理质量闭环、数据标准、标准映射、主索引、数据资产/血缘、分析看板、AI Data、数据服务与智能问数具备真实链路”，不要以全量医疗数据平台生产版对外承诺。
