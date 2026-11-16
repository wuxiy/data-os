# FE7 前端技术栈迁移验收：全站收口与发布准备

> 日期：2026-11-16｜Gate：FE7（终局）｜状态：**通过**（本地；未推送、未部署）
> 前置：FE6（`999782c`）｜计划完成定义见 [迁移计划 §1](../frontend-stack-migration-plan-20261116.md)

## 1. 结论

- **antd 与 dayjs 已从生产依赖移除**；全站唯一主题为 `src/styles/tokens.css`，旧 v3 主题/legacy 根/旧页面文件全部删除。
- 全部路由按页懒加载：入口 chunk 277KB（gzip 85KB）+ vendor 376KB + icons 34KB + 按页 chunk（对照 FE0 单包 1495KB）。
- 既有 45 项测试零修改，共 **93 项**全绿；双 QA 通过（含新增「生产依赖不得包含 antd」锁）。
- 浏览器矩阵 **29 路由 × 2 宽度（58 项）** + 1920px 抽样 + reduced-motion + FE2–FE6 全部业务流通过。
- 交付三类可复现制品与哈希清单、272 项依赖/许可证清单、**持久回滚包**（`64aa39b` 旧门户 zip，重建哈希与 FE0 基线完全一致），并完成本地静态目录新→旧→新切换演练。

## 2. 代码收口

| 项 | 处理 |
| --- | --- |
| 旧页面 | 30 个 antd 页面文件、`Pages.module.css` 等全部 CSS Modules、`rowMoreToggle` 删除；仅保留 `src/pages/MpiReviewLive.tsx`、`AssistantLive.tsx` 两个测试 seam（已重写为新栈实现） |
| 旧组件 | Surface/Primitives/PageHeader/Pager/ActionIcon/DemoDataBoundary/GovernanceTabs/ProductScopeNotice/CommandPalette(前删)/TrendChart/ResponsibilityChain 全删；`RuntimeStatusBanner` 改为 Query 读取（保留 2.5s 自超时与「首期真实范围 + 仅已验证问题」口径） |
| 旧主题 | `theme.ts`、`styles/legacy.css`、`#legacy-root`/`#legacy-overlay`、`app/legacy/` 渲染器删除；`main.tsx` 只引 `tokens.css` |
| 死数据 | `data/mock.ts`、`data/integrations.ts`、`types.ts` 删除（无引用） |
| 依赖 | `npm pkg delete dependencies.antd dependencies.dayjs`；`npm ls` 无残留；`npm audit --omit=dev --audit-level=high`（官方 registry）**0 漏洞** |
| 懒加载 | Router 全部 24 个页面组件 `React.lazy` + 壳内 `Suspense`；`manualChunks` 归并 lucide（icons）与 TanStack/Base UI（vendor），消除 0.3KB 碎片 |
| 兼容 seam | `hooks/useApiResource|useKeyedResource|usePolling|useAction|usePaged` 连同其 18 项测试保留（计划 §3.2），业务代码零引用 |
| 入口 | `index.html` theme-color 对齐浅色侧栏 `#f6f7f9` |

## 3. 测试与验收

| 检查 | 结果 |
| --- | --- |
| `npx tsc -b` | 通过 |
| `npx vitest run` | **21 文件 / 93 用例**全绿（原 45 零修改） |
| `node qa/mock-audit.mjs` | passed（含 antd-free 新锁） |
| `node qa/portal-interactions-smoke.mjs` | passed |
| `npm run build` | 成功；47 文件，见清单 |
| `node qa/browser-smoke.mjs --serve` | **29 路由 × 1440/1280 = 58 项** + 1920px×4 + reduced-motion 通过 |
| `--flows fe2,fe3,fe4,fe5,fe6` | 全部业务流在新构建复跑通过 |
| `npm audit --omit=dev`（registry.npmjs.org） | 0 漏洞（本地默认镜像不提供 audit 端点，属环境事实） |
| `git diff --check` | 干净 |

27 模式矩阵 = 17 既有入口 + 10 新工作页（含 `?tab=` 变体共 29 条 URL；动态页用 mock 控制面受控 ID）。

## 4. 制品与哈希（`docs/validation/frontend-artifacts-20261116/`）

| 制品 | 构建参数 | 证据 |
| --- | --- | --- |
| live 直连包 | 无演示、无 OIDC 键（本地直连模式） | `dist-live-direct.sha256`（47 文件） |
| live OIDC 包 | `VITE_DATAOS_API_BASE_URL=/api` + 三键守卫（不可达 issuer） | `dist-live-oidc.sha256`；实测渲染登录门（`PKG-CHECK gate ok`） |
| 显式演示审核包 | `VITE_DATAOS_DEMO_MODE=true` | `dist-demo.sha256`；实测渲染「演示运行模式 + 脱敏演示数据」横幅（`PKG-CHECK demo ok`），未设键时生产守卫语义不变 |
| 回滚包 | `64aa39b` 重建 | `portal-dist-rollback-64aa39b.zip`（472KB）+ `dist-rollback-64aa39b.sha256`；index.html 哈希 `930c16d6…` 与 FE0 基线记录**逐字一致**（可复现性实证） |
| 依赖清单 | — | `dependencies-licenses.txt`（272 项，含 license 与 direct 标记，0 处 antd） |

真实模式无演示：矩阵全部 58 项在 `VITE_DATAOS_DEMO_MODE` 未设的构建上通过，空态均为真实不可用态。

## 5. 切换演练（本地隔离静态目录）

用 `qa/static-spa-server.mjs`（每次请求读盘、SPA 回退、no-store）在 **同一端口同一进程** 下做目录原子替换：

| 阶段 | 结果 |
| --- | --- |
| A 新包在位 | index hash `3cc718af…`；`/governance/quality/scoring`、`/ingestion/jobs/$jobId` 深链直开可用 |
| B 换旧包（64aa39b） | index hash 变为 `930c16d6…`（与回滚清单一致）；旧深链 `?issue=`、17 基线路由可用；旧包遇到新工作页路径回落有内容页，**不白屏** |
| C 恢复新包 | hash 回到 `3cc718af…` |

结论：静态目录替换即生效（服务器不缓存）；生产侧若遇只读 bind mount 指向旧 inode，按 runbook `force-recreate portal`，无需重启其他组件。

## 6. QA 锁迁移登记（FE7 批）

| 旧锁 | 新落点 | 不变量 |
| --- | --- | --- |
| `types.ts` 的 assetTechnical/assistantWorkspace RouteKey | 路由表断言（FE1 已迁） | 两工作区可识别路由 |
| `AssetCatalogPage`/`AssistantPage` 的 `target="_blank"` + `routePaths` | `features/assets/asset-catalog-page.tsx` 的 `deepLinks.technicalAsset`、`features/assistant/assistant-page.tsx` 的 `/assistant/workspace` 入口 | v0.2 批准设计改为同壳页签导航（不再开新标签页）；FQN/路径深链保留 |
| `ProductScopeNotice` 范围与问数边界 | `RuntimeStatusBanner`（含「仅已验证问题」口径） | 首期范围 + 问数边界持续可见 |
| `QualityIssuesPage` 结果平铺禁令 | `features/governance/quality-page.tsx` | 批次消息不整段平铺 |
| `DemoDataBoundary` 演示副作用声明 | `runtimeMode.ts` + 接入编辑器锁 | 演示为显式构建开关 |
| `staticPages` DemoDataBoundary 清单（最后 5 页） | FE6 已换成的「17 路由 createRoute + 禁 legacy」锁继续生效 | 路由不回退演示页 |
| 新增 | `package.json` 无 antd + `main.tsx` 无 antd import | 完成定义 5 |

## 7. 开发环境发布操作单（待授权执行）

以下为固定步骤（对应计划 §9.2）；**本轮未执行任何远端动作**：

1. 备份：当前 portal-dist、Nginx/Compose 配置、容器 inspect、宿主/容器/HTTP 三处 bundle hash → 不可变回滚目录（本地已演练等价物：`portal-dist-rollback-64aa39b.zip`）。
2. 出包：以 dev 实际 `VITE_DATAOS_OIDC_ISSUER_URI/CLIENT_ID/REDIRECT_URI` 与 `VITE_DATAOS_API_BASE_URL` 构建；本地校验 + `artifact-manifest.mjs` 哈希；不把演示包当真实模式发布。
3. 替换：原子替换静态目录；若只读 bind mount 仍读旧 inode → `docker compose up -d --force-recreate portal`（仅 portal）。
4. 校验：宿主文件/容器文件/HTTP 返回三处 index/JS hash 一致；静态资源、17 基线入口与 10 新工作页直接刷新可达。
5. 冒烟：受控测试对象过登录/角色、采集配置与运行观察、质量登记与异步回写、资产/MPI、AI/服务/问数、交付；回读持久化结果；不可达按环境问题记录。
6. 回滚演练：换回旧包验证后恢复新包；提交 hash、测试对象、日志与未验证边界。

推送与远端 CI：待用户明示。授权后要求该提交前端 job 全绿（含 Vitest）。

## 8. 限制与遗留

- 本地默认 npm 镜像不提供 audit 端点；已用官方 registry 复核 0 漏洞，CI 在官方 registry 执行。
- `analysis` 嵌入在无真实看板 UUID 的环境下如实显示「嵌入失败」；dev 发布时以真实 BFF 验证。
- 旧 hooks 与其测试作为兼容 seam 保留（计划 §3.2）；后续单独清理须连测试一起退役并另行评审。
- 生产上线、生产代理补齐、H4/H5 不在本轮范围。
