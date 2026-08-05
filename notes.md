# Notes: Mock 能力核查与可落地化

## 当前基线

- 控制面默认 `DATAOS_SEED_DEMO=false`、`DATAOS_QUALITY_EXECUTOR=HTTP`，开发环境曾使用 `DEMO` 质量执行器做确定性验收。
- `DemoDataInitializer` 只有在显式开启 `data-os.seed-demo` 且数据库为空时写入种子来源、指标和治理问题。
- 前端治理问题页、数据接入页已经真实 API 优先，控制面不可用时显示不可用空态。
- `prototype/src/data/mock.ts` 仍被管理驾驶舱、治理驾驶舱、标准、MPI、资产、分析和智能问数页面直接引用；其中治理驾驶舱还有 API 失败后的本地 fallback 问题列表。
- `PageHeader` 明确提示部分筛选仍为演示行为；智能问数页面显示演示响应；数据接入模板中的 FakeSource → Console 明确标注演示。

## 风险判断

1. API 失败后治理驾驶舱使用 fallback 问题列表，会让甲方误以为控制面仍然有真实数据，和已落地的“不可用时不展示假问题”规则不一致。
2. 管理驾驶舱和治理驾驶舱指标仍来自静态 mock，没有统一的 API 状态标识；交付演示容易与真实数据混淆。
3. 资产、标准、MPI、分析、问数页面尚未接入控制面，这是产品边界而不是 bug；需要显式显示“演示/只读原型”而不是暗示已连通真实组件。
4. `DEMO` 执行器如果被部署到生产环境，会让规则结果看起来可用但并未运行真实规则，必须有启动时阻断或强提示。

## 目标验收

- API 故障时：管理/治理页不再静默显示 fallback 问题；呈现可见的连接状态和重试操作。
- 显式 demo 模式时：静态页面可正常体验，并显示统一的“演示数据”标记。
- 真实模式时：页面能通过 `/api` 获取已实现的控制面数据，空库显示真实空态，不自动注入 mock。
- 生产配置使用 HTTP/dbt 质量执行器时，启动检查能阻止缺失 endpoint 或明确报告未配置；DEMO 仅允许开发配置。
- 测试覆盖 API 故障、demo 模式、真实空态、DEMO 执行器保护和前端构建/交互。

## 已完成改动

- 新增 `RuntimeController` 与 `GET /api/v1/system/status`，报告 LIVE/DEMO、质量执行器、SeaTunnel、通知 Webhook 的配置状态和非敏感告警。
- `DemoQualityRuleExecutor` 增加 `data-os.quality.demo-enabled` 开关，默认关闭；测试 profile 和开发 Compose 显式开启。
- 新增 `DemoDataBoundary`、`RuntimeStatusBanner`、`VITE_DATAOS_DEMO_MODE`，静态模块真实模式只显示待接入边界，演示模式显示统一标记。
- 治理驾驶舱移除本地问题 fallback，真实模式不渲染静态责任链和趋势样例。
- 新增 `prototype/qa/mock-audit.mjs` 和 `npm run qa:mock`，文档归档在 `docs/mock-production-readiness.md`。

## 浏览器证据

- 默认真实模式：`/` 显示管理驾驶舱待接入边界，`/assets` 显示资产目录待接入边界，`/governance` 不出现静态问题/责任链/趋势样例。
- `VITE_DATAOS_DEMO_MODE=true` 构建：`/assets` 显示“演示模式”和脱敏资产样例，`/governance` 保留演示责任链结构。
- 两种模式本地浏览器控制台均无应用 error/warn；Browser SDK 的 Statsig 网络超时为工具自身遥测噪声，不属于应用日志。
