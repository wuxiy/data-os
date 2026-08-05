# Mock 能力核查与可落地边界

更新时间：2026-08-05

## 结论

当前项目已经把“演示数据”和“真实控制面数据”分成两种明确运行模式：

- 生产构建默认是真实模式。没有真实数据服务的页面不再渲染静态样例，而是显示“待接入真实服务”并引导进入已落地的数据接入、治理驾驶舱和质量闭环。
- 交互原型通过 `VITE_DATAOS_DEMO_MODE=true` 显式启用。演示页面顶部会显示“演示模式”，数据来自脱敏/合成数据，不代表业务事实。
- 治理驾驶舱和数据质量闭环以控制面 API 为准。控制面不可用时不再使用本地问题 mock 兜底。
- 控制面新增 `GET /api/v1/system/status`，只返回运行模式、执行器配置状态和非敏感告警，不返回 URL、密码或令牌。

## 页面边界

| 页面 | 当前数据来源 | 默认真实模式行为 | 演示模式行为 |
|---|---|---|---|
| 数据接入 | 控制面 `/api/v1/sources`、`/api/v1/jobs` | 可用，控制面不可用显示空态 | 同样走真实 API，不伪造运行状态 |
| 治理驾驶舱 | 控制面 `/api/v1/governance/summary` | 可用；失败不展示指标/问题 mock | 同样走控制面，种子数据需由后端显式开启 |
| 质量闭环 | 控制面治理问题、质量批次、通知 API | 可用，状态和证据来自 PostgreSQL | 同样走控制面 |
| 数据标准 | 当前为 `src/data/mock.ts` 原型数据 | 显示待接入真实服务，不展示样例 | 显示演示数据并标记 |
| 标准映射 | 当前为页面内原型数据 | 显示待接入真实服务，不展示样例 | 显示演示数据并标记 |
| 主索引审核 | 当前为 `src/data/mock.ts` 原型数据 | 显示待接入真实服务，不展示样例 | 显示演示数据并标记 |
| 数据资产/技术视图 | 当前为 `src/data/integrations.ts` 原型数据 | 显示待接入真实服务，不展示样例 | 显示演示数据并标记 |
| 分析看板 | 当前为 `src/data/integrations.ts` 原型数据 | 显示待接入真实服务，不展示样例 | 显示演示数据并标记 |
| 智能问数 | 当前为 `src/data/integrations.ts` 原型数据 | 显示待接入真实服务，不展示样例 | 显示演示回答并标记 |

资产、分析和问数的下一步不是把 mock 改名，而是分别接入 OpenMetadata、Superset 和 DB-GPT 的 BFF/Adapter；标准、映射和 MPI 则接入治理注册库、术语服务和 MPI 服务。当前页面保留交互模型，但不把原型数据当作已完成能力。

## 开发与部署

### 交互原型

```bash
cd prototype
VITE_DATAOS_DEMO_MODE=true npm run dev
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

- `npm run qa:mock`：确认静态页面均经过演示边界、治理 fallback 已移除、运行模式可见。
- `npm run build`：验证真实模式生产构建。
- `mvn -q -Dmaven.repo.local=/private/tmp/dataos-m2 test`：验证控制面契约、质量执行器和运行状态接口。
- 浏览器验证真实模式页面不会出现样例问题；演示模式页面显示“演示模式”标记。

## 仍需真实依赖才能进入正式验收的能力

1. 院内真实数据库/接口样本与只读账号。
2. dbt/质量规则执行器的真实 HTTP 服务地址和结果契约。
3. OpenMetadata、Superset、DB-GPT、MPI/MDM 的服务账号及 BFF 接入。
4. 责任人 Webhook 或院内消息通道。

这些依赖未就绪前，建议将当前版本定位为“数据接入 + 治理质量闭环可交付，其他页面为受控原型”，不要以全量医疗数据平台生产版对外承诺。
