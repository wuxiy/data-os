# G4 嵌入式分析验收报告（Superset 访客令牌 + 门户嵌入）— 2026-08-20

对照清单：`docs/analytics-g4-review-and-plan-20260820.md` §四（B1-B6，映射 gate-hospital-edge L6.1-L6.4）。全部结论基于开发机 172.16.65.59 实测。

## 结果：6/6 通过

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| B1 | 数据源接入（L6.1） | ✅ | Superset Doris 连接 `doris-ods-ep`（MySQL 协议 9030，只读）与 `ods_ep.ep_mz_cfzb` 数据集（id=2）为 spike 遗留并在本轮复用；G4.2 建图即基于该数据集 |
| B2 | 图表×3（L6.2） | ✅ | dashboard 2 现含 3 图：chart 5 开方量趋势（KFRQ 日粒度折线）、chart 6 开方科室 TOP10（JZKSMC 条形）、chart 4 处方平台状态分布（CFPTZT 饼图）；建图脚本 `deploy/scripts/superset-seed-g4-charts.py` 留 Git 可重现 |
| B3 | 数值对账（L6.3） | ✅ | 两维零误差：状态分布 17 组逐组一致（-1:6129、9:2278、5:1108…，合计 11,373）；科室 TOP10 全量一致（内科 8611、耳鼻喉科 2151、皮肤科 391…急诊科 5）。图表值（门户嵌入页截图可读）== Doris SQL 直查（`dataos_quality_ro`） |
| B4 | 访问留证（L6.4） | ✅ | 门户内嵌入截图 `portal-analytics-live-20260820.png`：甲方视角无 Superset 登录页/组件外壳，三图直接呈现在门户「分析看板」 |
| B5 | 访客令牌安全 | ✅ | token 由 BFF 签发（默认 300 秒）、role=Viewer、resources 限白名单仪表盘、rls 空；管理员凭据仅存远端 `.env`（0600 权限域）；白名单外 dashboard 请求 404（实测 id=9）；嵌入白名单 Referer 防线实测：无 Referer 403、门户 Referer 200 |
| B6 | 降级与分流 | ✅ | Superset 不可达 → 503（带原因消息）；未配置 → 503（稳定中文提示）；门户 `AnalyticsLive` 据此渲染「待接入」；demo 构建静态分析页零改动；control-plane 全量 126/126 绿（既有测试零修改） |

## 交付物清单

- **control-plane `analytics` 包**：`AnalyticsProperties`/`SupersetGuestTokenService`（管理员登录短缓存 → CSRF 双提交 → guest_token；仪表盘清单端点取 title/embedded uuid）+ `AnalyticsController`（`GET /api/v1/analytics/dashboards`、`POST /api/v1/analytics/guest-token`）；条件装配与血缘链同款纪律。
- **门户**：`@superset-ui/embedded-sdk` 0.4.0；`analyticsApi.ts` + `AnalyticsLive`（目录/嵌入画布/访问证据栏）；`runtimeMode` 分流与 MPI/资产页先例一致。
- **门户 nginx 双监听**：80（门户）+ 8084→发布 18084（Superset 全量代理，只承载 iframe）；compose 增 `DATAOS_SUPERSET_EMBED_PORT`。
- **Superset dev 配置**：`FEATURE_FLAGS.EMBEDDED_SUPERSET=True` 落入受版本管理的 `superset_config.dev.py`（spike 的开启曾随容器重建丢失，本轮根治）。

## 与方案的偏差与过程修复（已回写方案 D1）

1. **嵌入通道换型**：原子路径方案（`/superset/` + X-Script-Name）被实测否决——embedded-sdk 硬拼 `${domain}/embedded/{uuid}`（Superset 顶层路由），且 Superset 顶层 `/api`、`/static` 与门户命名空间不可调和；改为门户 nginx 专用监听端口（跨源 postMessage 为 SDK 原生模式）。Referer 白名单防线在换型后仍然生效（Superset 侧按仪表盘 allowed_domains 校验）。
2. **EMBEDDED_SUPERSET 特性随容器重建丢失**（spike 遗留开启未落配置）：本轮落入 `superset_config.dev.py` 并备份原文件（`.pre-g4-20260820`）。
3. **guest_token 的 CSRF 双提交**：需 `session` cookie + `X-CSRFToken`（flask-wtf 双提交）+ Referer；请求体键为 `rls`（非 rls_rules）、单体响应包在 `result` 字段。
4. **一处误导性 503 文案**：dashboards 端点 catch 复用「未配置」文案，掩盖真实失败（远端 `.env` 中口令为未展开的字面 `$(cat …)`——引号 heredoc 阻止了替换）；已修复文案并注入真实值，503 消息现在带服务层原因。
5. **门户分析页路由为 `/analysis`**（非 /analytics），验收截图按正确路由留证。

## 遗留与下一步

- guest token 每次现签（无短窗缓存）与限流——延后清单
- 生产口径收紧：Talisman/显式 CSP、Superset spike 管理员口令轮换（现为 .env 0600）
- 更多仪表盘、RLS 行级安全、OM「图表↔资产」互跳——延后清单
- G5（院内全流程模拟）：血缘/分析页均已真实化，可按门户口径修订 gate 清单后执行
