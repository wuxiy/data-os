# 分析页真实化方案（G4 嵌入式 Superset）— 2026-08-20

> **实施状态（2026-08-20）**：G4.1-G4.6 已全部完成（验收
> `docs/validation/gate-analytics-g4-20260820.md`，6/6；L6.2 图表×3 与 L6.3
> 数值对账零误差一并达成）。实施中的通道换型与四处过程修复见验收报告
> 「与方案的偏差」。延后清单不变。

目标：把门户「分析看板」从静态演示改为嵌入式 Superset 真实链路——访客令牌由控制面 BFF 签发（甲方免登录、按仪表盘限权），仪表盘经**门户同源路径**呈现（不暴露 Superset 控制台、不受网关自签证书影响），并补齐 L6 口径的图表×3 与数值对账（为 G5 院内模拟的 L6 验收打前站）。

## 一、现状事实（2026-08-20 实测）

| # | 事实 |
| --- | --- |
| 1 | Superset 4.1（`medical-platform-superset-1`，platform-net 内 `superset:8088`）已开 `EMBEDDED_SUPERSET`；`ENABLE_PROXY_FIX=True`、`TALISMAN_ENABLED=False`（spike 遗留口径） |
| 2 | dashboard 2「电子处方嵌入验证」已配嵌入：uuid `377e2939-8bdd-4c88-97aa-11bb3f77cc6b`、allowed_domains=`http://172.16.65.59:18081`（门户 origin）；当前仅 1 图（处方状态分布，chart 4，数据集 ep_mz_cfzb） |
| 3 | 网关 8444 对 Superset 是**根路径**直转（无 /superset 前缀；8443 的 /superset 已改 301 过渡）；spike 的嵌入验证走的就是根路径 |
| 4 | 门户 nginx（18081）现有 /api/v1/mpi/、/api/、/healthz、/assets、SPA 兜底；无 Superset 通道 |
| 5 | 门户分析页 `AnalyticsPage` 全静态（`data/integrations` dashboards + TrendChart 样例）；无任何 Superset 集成 |
| 6 | 图表所需列已在 `ods_ep.ep_mz_cfzb` 确认：`KFRQ`（开方日期）、`JZKSMC`（科室名称）、`CFPTZT`（平台状态） |

## 二、设计决策

| # | 决策 | 理由 |
| --- | --- | --- |
| D1 | **门户 nginx 增设专用监听 18084 → `superset:8088` 全量代理**，embedded-sdk 的 `supersetDomain` 指向 `http://172.16.65.59:18084` | 实测否决了原子路径方案：SDK 0.4.0 硬拼 `${domain}/embedded/{uuid}`（Superset 顶层路由），而 Superset 的 `/api`、`/static` 顶层命名空间与门户 80 的 `/api`（control-plane）、静态资源不可调和；独立端口保持 Superset 路由零改写。同 host 免网关自签证书；跨源 postMessage 为 SDK 原生模式；嵌入白名单（dashboard allowed_domains=门户 origin）经 Referer 校验实证：无 Referer 403、门户 Referer 200 |
| D2 | **BFF 访客令牌端点**：control-plane `analytics` 包，`POST /api/v1/analytics/guest-token`（body `{dashboardId}`）→ `{token, dashboardId, expiresIn}`。内部流程：Superset 管理员凭据（env）登录换 access_token → `POST /superset/api/v1/security/guest_token/`（user/role=Viewer/resources 限 dashboard/rls 空/短时效）。**dashboardId 白名单**由配置持有，白名单外 404；管理员凭据与 token 永不出 BFF | 与 quality/lineage 适配器同一纪律（专用凭据 + 超时降级 503 + 投影最小化）；guest token 是浏览器侧短时效凭证，泄露面=单个仪表盘只读 |
| D3 | 门户 `AnalyticsLive`：`@superset-ui/embedded-sdk` 嵌入（`supersetDomain` 指向门户 `/superset` 同源路径，`fetchGuestToken` 回调走 BFF）；SDK 安装为运行时依赖。runtimeMode 分流与 MPI/资产页一致（demo 构建静态页零改动）；BFF 503/失败时显示「待接入」边界 | 框架无关 postMessage 协议适配 React 19（spike 已验证 SDK 可用） |
| D4 | **图表×3 补齐**（L6.2 前置）：在 Superset 用 REST API 建 ①开方量趋势（KFRQ 日粒度折线）②开方科室 TOP10（JZKSMC 条形）③处方平台状态分布（已有 chart 4 饼图），挂入 dashboard 2 | L6.2/L6.3 是 G5 院内模拟的验收项，G4 顺带补齐可直接对账；API 建图留脚本可重现 |
| D5 | CSP 口径：同源嵌入下 frame-ancestors 由 Superset 嵌入白名单（allowed_domains 已限门户 origin）约束；Talisman 保持关闭（dev 口径）。**生产收紧**（显式 CSP 段 + 令牌轮换）入延后清单 | 开 Talisman 曾阻断嵌入（spike 实测自定义 CSP 段未完全生效）；同源 + 嵌入白名单已消除跨域暴露，不为演示引入不确定配置 |
| D6 | 数值对账（L6.3）：任选两维（状态分布、科室 TOP10），图表聚合值 vs Doris SQL 直查零误差；报告只记数字不记 PHI | 门户口径的证据链 |

## 三、实施步骤

| # | 步骤 | 通过标准 |
| --- | --- | --- |
| G4.1 | 门户 nginx 增 `/superset/` 反代（X-Script-Name）；远端 reload 后 `curl http://localhost:18081/superset/healthz` 200、dashboard 页 HTML 可取、静态资源带前缀 | 同源链路通；若 SCRIPT_NAME 不生效按 D1 回退并如实记录 |
| G4.2 | Superset 图表×3：API 建趋势/TOP10 两图并挂 dashboard 2（脚本留 Git） | dashboard 2 含 3 图；图表可渲染 |
| G4.3 | control-plane：`AnalyticsProperties`/`SupersetGuestTokenService`/`AnalyticsController` + 契约测试（登录→guest-token 编排、白名单 404、不可达 503、凭据不透出） | mvn 全量零修改全绿（新增除外） |
| G4.4 | 门户：安装 embedded-sdk；`analyticsApi.ts` + `AnalyticsLive`；分流改造 | tsc/vitest/qa/build 全绿 |
| G4.5 | 远端部署联调（control-plane 新镜像 + portal-dist + nginx），浏览器验证嵌入 + 数值对账 + 截图留证 | 甲方视角：门户内免登录看到仪表盘；对账零误差 |
| G4.6 | 验收报告 `docs/validation/gate-analytics-g4-20260820.md`（对照 L6.1-L6.4 + G4 专属项）+ CONTEXT 术语（分析页/访客令牌） | 报告落库 |

## 四、验收清单（对照 gate-hospital-edge L6 + G4 专属）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| B1 | 数据源接入（L6.1） | Superset Doris 连接（doris-ods-ep）+ ep_mz_cfzb 数据集已在（spike 遗留，复核） |
| B2 | 图表×3（L6.2） | 趋势（KFRQ 日）/科室 TOP10（JZKSMC）/状态分布（CFPTZT）三图在册且挂 dashboard 2 |
| B3 | 数值对账（L6.3） | 两维图表聚合 == Doris 直查，误差 0 |
| B4 | 访问留证（L6.4） | 门户内（同源嵌入）截图；无 Superset 登录页暴露 |
| B5 | 访客令牌安全 | token 短时效（≤10 分钟）；role=Viewer；resources 限白名单仪表盘；BFF 不回显管理员凭据；白名单外 dashboard 404 |
| B6 | 降级与分流 | Superset 不可达 → BFF 503 → 门户「待接入」；demo 构建静态页零改动；既有测试零修改全绿 |

## 五、延后清单

- 生产 CSP 收紧（Talisman/显式 frame-ancestors）与 Superset 凭据轮换（spike 管理员口令）
- guest token 缓存/限流（按用户+仪表盘短窗缓存，当前每次签发）
- 更多仪表盘与 RLS 行级安全（多租户口径）
- OM「图表↔资产」互跳（superset-dataos 实体与嵌入页联动）
